package app.valkyrie.phone

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Process
import android.util.Base64
import java.io.ByteArrayOutputStream
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** Reads which apps were on screen, using the "Usage access" permission the person switches on in Settings. */
object UsageReader {
    fun hasAccess(context: Context): Boolean {
        val ops = context.getSystemService(AppOpsManager::class.java)
        val mode = ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
        return mode == AppOpsManager.MODE_ALLOWED
    }

    private fun events(context: Context, from: Long, now: Long): List<Ev> {
        val manager = context.getSystemService(UsageStatsManager::class.java)
        // Start a little early so an app already open at the start of the range is seen opening.
        val stream = manager.queryEvents(from - 6 * 3_600_000L, now)
        val events = ArrayList<Ev>()
        val e = UsageEvents.Event()
        while (stream.hasNextEvent()) {
            stream.getNextEvent(e)
            events.add(Ev(e.timeStamp, e.eventType, e.packageName ?: ""))
        }
        return events
    }

    /** Seconds per app (by package name) for each of the last `days` days, today included. Every day is there, even if empty. */
    fun read(context: Context, days: Int): Map<LocalDate, Map<String, Long>> {
        val zone = ZoneId.systemDefault()
        val today = LocalDate.now(zone)
        val from = today.minusDays((days - 1).toLong()).atStartOfDay(zone).toInstant().toEpochMilli()
        val now = System.currentTimeMillis()

        val byDay = UsageMath.totals(events(context, from, now), from, now, zone, ignored(context))
        return (0 until days).associate { i ->
            val day = today.minusDays((days - 1 - i).toLong())
            day to (byDay[day] ?: emptyMap())
        }
    }

    /**
     * Everything the phone still has, up to `days` days back. The recent days come from the detailed log, which is exact
     * but only goes back a week or so. Days before that come from the daily totals Android keeps for much longer, so only
     * days that have something are in the result.
     */
    fun readHistory(context: Context, days: Int): Map<LocalDate, Map<String, Long>> {
        val zone = ZoneId.systemDefault()
        val today = LocalDate.now(zone)
        val first = today.minusDays((days - 1).toLong())
        val from = first.atStartOfDay(zone).toInstant().toEpochMilli()
        val now = System.currentTimeMillis()
        val ignore = ignored(context)

        val events = events(context, from, now)
        // The first day the log has anything for is probably only half there, so the log is trusted from the next day.
        val firstLogged = events.minOfOrNull { it.time }?.let { Instant.ofEpochMilli(it).atZone(zone).toLocalDate() }
        val exactFrom = firstLogged?.plusDays(1)?.takeIf { it <= today } ?: today
        val exact = UsageMath.totals(events, maxOf(from, exactFrom.atStartOfDay(zone).toInstant().toEpochMilli()), now, zone, ignore)

        val manager = context.getSystemService(UsageStatsManager::class.java)
        val stats = manager.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, from - 24 * 3_600_000L, now)
            .map { DailyStat(it.firstTimeStamp, it.packageName ?: "", it.totalTimeInForeground) }
        val older = UsageMath.older(stats, exactFrom, zone, ignore).filterKeys { !it.isBefore(first) }

        val recent = generateSequence(exactFrom) { it.plusDays(1) }.takeWhile { it <= today }
            .associateWith { exact[it] ?: emptyMap() }
        return older + recent
    }

    // The home screen and the system's own screens are not time "in an app".
    private fun ignored(context: Context): Set<String> {
        val home = context.packageManager
            .resolveActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), PackageManager.MATCH_DEFAULT_ONLY)
            ?.activityInfo?.packageName
        return setOfNotNull(home, "com.android.systemui", "android")
    }

    /** What the person knows the app as ("YouTube"). Null when it is not installed any more. */
    fun label(context: Context, pkg: String): String? = try {
        val pm = context.packageManager
        pm.getApplicationInfo(pkg, 0).loadLabel(pm).toString().trim().ifBlank { null }
    } catch (e: PackageManager.NameNotFoundException) {
        null
    }

    /** The app's icon as a small PNG in base64, or null if it can't be drawn. */
    fun iconBase64(context: Context, pkg: String): String? = try {
        val drawable = context.packageManager.getApplicationIcon(pkg)
        // 64 pixels is plenty for a 20 pixel icon; fall back to smaller if an icon is unusually heavy.
        listOf(64, 40).firstNotNullOfOrNull { size ->
            val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
            drawable.setBounds(0, 0, size, size)
            drawable.draw(Canvas(bitmap))
            val out = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
            bitmap.recycle()
            if (out.size() <= 18_000) Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP) else null
        }
    } catch (e: Exception) {
        null
    }
}
