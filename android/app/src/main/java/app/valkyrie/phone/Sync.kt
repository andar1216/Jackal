package app.valkyrie.phone

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.time.LocalDate
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONObject

/** Reads this phone's screen time and sends it to Valkyrie. */
object Sync {
    private const val WORK_NAME = "valkyrie-sync"
    private const val FIRST_DAYS = 7 // Android only keeps about a week of detail
    private const val REFRESH_DAYS = 3
    private const val EVERY_MINUTES = 30L

    /** Packages are called by their labels everywhere else, so two apps with one label are one line. */
    class Reading(val days: Map<LocalDate, Map<String, Long>>, val packageOf: Map<String, String>)

    fun readByLabel(context: Context, days: Int): Reading {
        val labels = HashMap<String, String?>()
        val packageOf = HashMap<String, String>()
        val byDay = UsageReader.read(context, days).mapValues { (_, apps) ->
            val named = HashMap<String, Long>()
            for ((pkg, seconds) in apps) {
                val label = labels.getOrPut(pkg) { UsageReader.label(context, pkg) } ?: continue // uninstalled since
                packageOf.putIfAbsent(label, pkg)
                named[label] = (named[label] ?: 0L) + seconds
            }
            named as Map<String, Long>
        }
        return Reading(byDay, packageOf)
    }

    private val lock = Any()

    /** Does one sync and returns what to tell the person. Safe to call from any background thread. */
    fun run(context: Context): String = synchronized(lock) { runLocked(context) }

    private fun runLocked(context: Context): String {
        val store = Store(context)
        val token = store.token
        if (token.isNullOrBlank() || store.server.isBlank()) return "Not paired yet."
        val message = try {
            if (!UsageReader.hasAccess(context)) throw ApiException(-1, "Usage access is off. Turn it on for Valkyrie in Settings.")
            val reading = readByLabel(context, if (store.lastSyncMs == 0L) FIRST_DAYS else REFRESH_DAYS)

            val days = JSONArray()
            var apps = 0
            for ((day, byApp) in reading.days.toSortedMap()) {
                val list = JSONArray()
                for ((name, seconds) in byApp) list.put(JSONObject().put("app", name).put("seconds", seconds))
                apps += byApp.size
                days.put(JSONObject().put("day", day.toString()).put("apps", list))
            }
            val wanted = Api.sync(store.server, token, days)

            // The server asks for a picture of each app it has none for. A failure here must not fail the sync.
            runCatching {
                wanted.chunked(10).forEach { chunk ->
                    val icons = chunk.mapNotNull { name -> reading.packageOf[name]?.let { UsageReader.iconBase64(context, it) }?.let { name to it } }.toMap()
                    if (icons.isNotEmpty()) Api.icons(store.server, token, icons)
                }
            }

            store.lastSyncMs = System.currentTimeMillis()
            "Sent $apps app totals for ${reading.days.size} days."
        } catch (e: ApiException) {
            if (e.status == 401) {
                store.forgetPairing()
                cancelAutomatic(context)
            }
            e.message ?: "Something went wrong."
        } catch (e: SecurityException) {
            "Usage access is off. Turn it on for Valkyrie in Settings."
        }
        store.lastMessage = message
        return message
    }

    /** Keeps syncing by itself, about every half hour, even when the app is closed. */
    fun scheduleAutomatic(context: Context) {
        val request = PeriodicWorkRequestBuilder<SyncWorker>(EVERY_MINUTES, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
    }

    fun cancelAutomatic(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
    }
}

class SyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    // Away from home the server can't be reached. That is not worth retrying in a hurry: the next run is half an hour away.
    override fun doWork(): Result {
        Sync.run(applicationContext)
        return Result.success()
    }
}
