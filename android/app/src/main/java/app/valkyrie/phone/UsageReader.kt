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
import java.time.LocalDate
import java.time.ZoneId

/** Reads which apps were on screen, using the "Usage access" permission the person switches on in Settings. */
object UsageReader {
    fun hasAccess(context: Context): Boolean {
        val ops = context.getSystemService(AppOpsManager::class.java)
        val mode = ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
        return mode == AppOpsManager.MODE_ALLOWED
    }

    /** Seconds per app (by package name) for each of the last `days` days, today included. Every day is there, even if empty. */
    fun read(context: Context, days: Int): Map<LocalDate, Map<String, Long>> {
        val zone = ZoneId.systemDefault()
        val today = LocalDate.now(zone)
        val from = today.minusDays((days - 1).toLong()).atStartOfDay(zone).toInstant().toEpochMilli()
        val now = System.currentTimeMillis()

        val manager = context.getSystemService(UsageStatsManager::class.java)
        // Start a little early so an app already open at the start of the range is seen opening.
        val stream = manager.queryEvents(from - 6 * 3_600_000L, now)
        val events = ArrayList<Ev>()
        val e = UsageEvents.Event()
        while (stream.hasNextEvent()) {
            stream.getNextEvent(e)
            events.add(Ev(e.timeStamp, e.eventType, e.packageName ?: ""))
        }

        val byDay = UsageMath.totals(events, from, now, zone, ignored(context))
        return (0 until days).associate { i ->
            val day = today.minusDays((days - 1 - i).toLong())
            day to (byDay[day] ?: emptyMap())
        }
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
