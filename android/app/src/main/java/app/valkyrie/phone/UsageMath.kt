package app.valkyrie.phone

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** One thing Android noted: at `time`, something happened to the app `pkg`. `type` is a UsageEvents.Event constant. */
data class Ev(val time: Long, val type: Int, val pkg: String)

/**
 * Turns Android's log of "this app came to the front / went away" into seconds per app per day.
 * It is plain Kotlin so it can be tested without a phone.
 */
object UsageMath {
    // The numbers of UsageEvents.Event.ACTIVITY_RESUMED, ACTIVITY_PAUSED, SCREEN_NON_INTERACTIVE and DEVICE_SHUTDOWN.
    const val RESUMED = 1
    const val PAUSED = 2
    const val SCREEN_OFF = 16
    const val SHUTDOWN = 26

    /**
     * Seconds each app was on screen, per day, for the time from `from` to `to` (milliseconds). Days are the phone's own days.
     * Only one app is on screen at a time: an app is on screen from when it resumes until it pauses, another app takes over,
     * the screen turns off, or the phone shuts down. Apps in `ignore` (the home screen and so on) are not counted.
     */
    fun totals(events: List<Ev>, from: Long, to: Long, zone: ZoneId, ignore: Set<String>): Map<LocalDate, Map<String, Long>> {
        val millis = HashMap<LocalDate, HashMap<String, Long>>()

        fun add(pkg: String, start: Long, end: Long) {
            var at = maxOf(start, from)
            val stop = minOf(end, to)
            while (at < stop) {
                val day = Instant.ofEpochMilli(at).atZone(zone).toLocalDate()
                val dayEnd = day.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
                val until = minOf(stop, dayEnd)
                val apps = millis.getOrPut(day) { HashMap() }
                apps[pkg] = (apps[pkg] ?: 0L) + (until - at)
                at = until
            }
        }

        var current: String? = null
        var since = 0L
        fun close(at: Long) {
            val pkg = current ?: return
            if (pkg !in ignore) add(pkg, since, at)
            current = null
        }

        for (e in events.sortedBy { it.time }) {
            when (e.type) {
                RESUMED -> {
                    close(e.time)
                    current = e.pkg
                    since = e.time
                }
                PAUSED -> if (current == e.pkg) close(e.time)
                SCREEN_OFF, SHUTDOWN -> close(e.time)
            }
        }
        close(to) // still on screen right now

        return millis.mapValues { (_, apps) -> apps.mapValues { (it.value + 500) / 1000 }.filterValues { it > 0 } }
    }
}
