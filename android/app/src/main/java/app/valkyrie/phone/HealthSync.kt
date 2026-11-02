package app.valkyrie.phone

import android.app.Activity
import android.content.Context
import android.content.Intent
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import java.time.Duration
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import kotlin.concurrent.thread
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject

/**
 * Reads the exercise sessions that other apps (Strong, Google Fit, Samsung Health...) saved to Health Connect, and sends
 * them to Valkyrie. A session is when and how long, and what it was called. The sets of a lift are not in it: those
 * come from Strong's own export.
 */
object HealthSync {
    private val READ = HealthPermission.getReadPermission(ExerciseSessionRecord::class)

    /** The window read each time. Health Connect hands over 30 days from when it was allowed, before the permission is used up. */
    private const val DAYS = 30L

    enum class Status { READY, NEEDS_APP, UNAVAILABLE }

    fun status(context: Context): Status = when (HealthConnectClient.getSdkStatus(context)) {
        HealthConnectClient.SDK_AVAILABLE -> Status.READY
        HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> Status.NEEDS_APP
        else -> Status.UNAVAILABLE
    }

    /** The screen that asks the person, to be opened with startActivityForResult. */
    fun permissionIntent(context: Context): Intent = PermissionController.createRequestPermissionResultContract().createIntent(context, setOf(READ))

    /** Health Connect's own settings, where the person can allow or take away what each app may read. */
    fun settingsIntent(context: Context): Intent = HealthConnectClient.getHealthConnectManageDataIntent(context)

    /** Whether the person said yes, from the result of that screen. */
    fun allowed(resultCode: Int, data: Intent?): Boolean =
        READ in PermissionController.createRequestPermissionResultContract().parseResult(resultCode, data)

    /** Call from a background thread. */
    fun hasPermission(context: Context): Boolean = runBlocking {
        READ in HealthConnectClient.getOrCreate(context).permissionController.getGrantedPermissions()
    }

    /** The last month's sessions, as the server takes them. Call from a background thread. */
    fun sessions(context: Context): JSONArray = runBlocking {
        val client = HealthConnectClient.getOrCreate(context)
        val now = Instant.now()
        val found = JSONArray()
        var page: String? = null
        do {
            val answer = client.readRecords(
                ReadRecordsRequest(ExerciseSessionRecord::class, TimeRangeFilter.between(now.minus(Duration.ofDays(DAYS)), now), pageToken = page),
            )
            for (s in answer.records) {
                val zone = s.startZoneOffset ?: ZoneId.systemDefault()
                val kind = ExerciseSessionRecord.EXERCISE_TYPE_INT_TO_STRING_MAP[s.exerciseType]
                found.put(
                    JSONObject()
                        .put("id", s.metadata.id)
                        .put("type", s.title?.takeIf { it.isNotBlank() } ?: WorkoutMath.typeName(kind))
                        .put("date", LocalDateTime.ofInstant(s.startTime, zone).toLocalDate().toString())
                        .put("durationMin", WorkoutMath.minutes(Duration.between(s.startTime, s.endTime).seconds))
                        .put("app", s.metadata.dataOrigin.packageName),
                )
            }
            page = answer.pageToken
        } while (!page.isNullOrEmpty())
        found
    }

    /** Reads and sends. Call from a background thread. Says how many sessions the server newly took in. */
    fun send(context: Context, server: String, token: String): Int {
        val sessions = sessions(context)
        if (sessions.length() == 0) return 0
        return Api.healthSessions(server, token, sessions).optInt("added")
    }

    /** Quietly, when the app opens: only if the person already allowed it and the phone is paired. */
    fun syncInBackground(activity: Activity, store: Store) {
        val token = store.token ?: return
        if (status(activity) != Status.READY) return
        thread {
            try {
                if (hasPermission(activity)) send(activity, store.server, token)
            } catch (e: Exception) {
                // Not reachable or not allowed now: it will be read again the next time.
            }
        }
    }
}
