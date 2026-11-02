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
    private const val HISTORY_DAYS = 1100 // asks for about three years; the phone only has what it has
    private const val MAX_DAYS_PER_SEND = 31
    private const val REFRESH_DAYS = 3
    private const val EVERY_MINUTES = 30L

    /** Packages are called by their labels everywhere else, so two apps with one label are one line. */
    class Reading(
        val days: Map<LocalDate, Map<String, Long>>,
        val packageOf: Map<String, String>,
        val note: String = "",
        /** Unlocks per day, and notifications per app label, for the days the phone could count exactly. */
        val unlocks: Map<LocalDate, Int> = emptyMap(),
        val notifications: Map<LocalDate, Map<String, Int>> = emptyMap(),
    )

    fun readByLabel(context: Context, days: Int, history: Boolean = false): Reading {
        val labels = HashMap<String, String?>()
        val packageOf = HashMap<String, String>()
        val usage = if (history) UsageReader.readHistory(context, days) else UsageReader.read(context, days)
        val note = usage.note
        val read = usage.days
        val notifications = usage.counts.mapValues { (_, c) ->
            val named = HashMap<String, Int>()
            for ((pkg, n) in c.notifications) {
                val label = labels.getOrPut(pkg) { UsageReader.label(context, pkg) } ?: continue
                packageOf.putIfAbsent(label, pkg)
                named[label] = (named[label] ?: 0) + n
            }
            named as Map<String, Int>
        }
        val byDay = read.mapValues { (_, apps) ->
            val named = HashMap<String, Long>()
            for ((pkg, seconds) in apps) {
                val label = labels.getOrPut(pkg) { UsageReader.label(context, pkg) } ?: continue // uninstalled since
                packageOf.putIfAbsent(label, pkg)
                named[label] = (named[label] ?: 0L) + seconds
            }
            named as Map<String, Long>
        }
        return Reading(byDay, packageOf, note, usage.counts.mapValues { it.value.unlocks }, notifications)
    }

    private val lock = Any()

    /** Does one sync and returns what to tell the person. Safe to call from any background thread. */
    fun run(context: Context, everything: Boolean = false): String = synchronized(lock) { runLocked(context, everything) }

    private fun runLocked(context: Context, forceEverything: Boolean): String {
        val store = Store(context)
        val token = store.token
        if (token.isNullOrBlank() || store.server.isBlank()) return "Not paired yet."
        // The first sync after pairing (or after an update) takes in everything the phone still has.
        val everything = forceEverything || !store.historyDone
        val message = try {
            if (!UsageReader.hasAccess(context)) throw ApiException(-1, "Usage access is off. Turn it on for Valkyrie in Settings.")
            val reading = if (everything) readByLabel(context, HISTORY_DAYS, history = true) else readByLabel(context, REFRESH_DAYS)

            var apps = 0
            val sent = LinkedHashSet<String>()
            // The server takes a month at a time.
            for (chunk in reading.days.toSortedMap().entries.chunked(MAX_DAYS_PER_SEND)) {
                val days = JSONArray()
                for ((day, byApp) in chunk) {
                    val list = JSONArray()
                    for ((name, seconds) in byApp) list.put(JSONObject().put("app", name).put("seconds", seconds))
                    apps += byApp.size
                    val entry = JSONObject().put("day", day.toString()).put("apps", list)
                    reading.unlocks[day]?.let { unlocks ->
                        val notified = JSONArray()
                        for ((name, count) in reading.notifications[day] ?: emptyMap()) notified.put(JSONObject().put("app", name).put("count", count))
                        entry.put("unlocks", unlocks).put("notifications", notified)
                    }
                    days.put(entry)
                }
                sent.addAll(Api.sync(store.server, token, days))
            }
            if (everything) store.historyDone = true
            val wanted = sent.toList()

            // The server asks for a picture of each app it has none for. A failure here must not fail the sync.
            runCatching {
                wanted.chunked(10).forEach { chunk ->
                    val icons = chunk.mapNotNull { name -> reading.packageOf[name]?.let { UsageReader.iconBase64(context, it) }?.let { name to it } }.toMap()
                    if (icons.isNotEmpty()) Api.icons(store.server, token, icons)
                }
            }

            store.lastSyncMs = System.currentTimeMillis()
            val oldest = reading.days.keys.minOrNull()
            "Sent $apps app totals for ${reading.days.size} days" + (oldest?.let { ", the oldest being $it" } ?: "") + "." +
                (if (everything) "\n${reading.note}" else "")
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
        if (everything) store.historyMessage = message
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
