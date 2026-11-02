package app.valkyrie.phone

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** One thing Android noted: at `time`, something happened to the app `pkg`. `type` is a UsageEvents.Event constant. */
data class Ev(val time: Long, val type: Int, val pkg: String)

/** Android's own total for one app on one day (`UsageStats`): the day's start in milliseconds and the milliseconds on screen. */
data class DailyStat(val firstMs: Long, val pkg: String, val millis: Long)

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
    const val NOTIFICATION = 12 // UsageEvents.Event.NOTIFICATION_INTERRUPTION: an app's notification got the person's attention
    const val UNLOCK = 18 // UsageEvents.Event.KEYGUARD_HIDDEN: the lock screen went away

    /** Calls `each(pkg, start, end)` for every stretch an app was on screen (the ignored ones left out). See `totals` for the rules. */
    private fun intervals(events: List<Ev>, to: Long, ignore: Set<String>, each: (String, Long, Long) -> Unit) {
        var current: String? = null
        var since = 0L
        fun close(at: Long) {
            val pkg = current ?: return
            if (pkg !in ignore) each(pkg, since, at)
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
    }

    /** A day has 96 quarter hours: 0 is 12:00 to 12:15 am, 37 is 9:15 to 9:30 am, by the phone's own clock. */
    const val QUARTER_SECONDS = 900L

    /**
     * When each app was on screen: per day, per app (by package), the seconds in each quarter hour of the day that it was
     * (so an app open from 9:10 to 9:40 has 300 seconds in quarter 36, 900 in 37 and 600 in 38). Same rules as `totals`.
     */
    fun slots(events: List<Ev>, from: Long, to: Long, zone: ZoneId, ignore: Set<String>): Map<LocalDate, Map<String, Map<Int, Long>>> {
        val millis = HashMap<LocalDate, HashMap<String, HashMap<Int, Long>>>()
        intervals(events, to, ignore) { pkg, start, end ->
            var at = maxOf(start, from)
            val stop = minOf(end, to)
            while (at < stop) {
                val local = Instant.ofEpochMilli(at).atZone(zone)
                val quarter = local.hour * 4 + local.minute / 15
                val next = local.truncatedTo(java.time.temporal.ChronoUnit.MINUTES).minusMinutes((local.minute % 15).toLong()).plusMinutes(15)
                val until = minOf(stop, next.toInstant().toEpochMilli())
                val perApp = millis.getOrPut(local.toLocalDate()) { HashMap() }.getOrPut(pkg) { HashMap() }
                perApp[quarter] = (perApp[quarter] ?: 0L) + (until - at)
                at = until
            }
        }
        return millis.mapValues { (_, apps) ->
            apps.mapValues { (_, quarters) -> quarters.mapValues { minOf(QUARTER_SECONDS, (it.value + 500) / 1000) }.filterValues { it > 0 } }
                .filterValues { it.isNotEmpty() }
        }.filterValues { it.isNotEmpty() }
    }
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

        intervals(events, to, ignore) { pkg, start, end -> add(pkg, start, end) }

        return millis.mapValues { (_, apps) -> apps.mapValues { (it.value + 500) / 1000 }.filterValues { it > 0 } }
    }

    /** How many times the phone was unlocked in a day, and how many notifications each app (by package) sent. */
    class DayCounts(val unlocks: Int, val notifications: Map<String, Int>)

    /** Unlocks and notifications per day for the time from `from` to `to`. Only days with something are in the result. */
    fun counts(events: List<Ev>, from: Long, to: Long, zone: ZoneId, ignore: Set<String>): Map<LocalDate, DayCounts> {
        val unlocks = HashMap<LocalDate, Int>()
        val notifications = HashMap<LocalDate, HashMap<String, Int>>()
        for (e in events) {
            if (e.time < from || e.time >= to) continue
            val day = Instant.ofEpochMilli(e.time).atZone(zone).toLocalDate()
            when (e.type) {
                UNLOCK -> unlocks[day] = (unlocks[day] ?: 0) + 1
                NOTIFICATION -> if (e.pkg !in ignore && e.pkg.isNotEmpty()) {
                    val byApp = notifications.getOrPut(day) { HashMap() }
                    byApp[e.pkg] = (byApp[e.pkg] ?: 0) + 1
                }
            }
        }
        return (unlocks.keys + notifications.keys).associateWith { DayCounts(unlocks[it] ?: 0, notifications[it] ?: emptyMap()) }
    }

    /**
     * Seconds per app for the days before `before`, from the daily totals Android keeps for far longer than the detailed log.
     * Android may hold more than one total for the same app and day (for example after the clock zone changed), so the
     * biggest one is taken rather than adding them. A day's total starts when the phone was first used after midnight
     * (not at midnight itself), so it belongs to the day it starts on.
     */
    fun older(stats: List<DailyStat>, before: LocalDate, zone: ZoneId, ignore: Set<String>): Map<LocalDate, Map<String, Long>> {
        val best = HashMap<LocalDate, HashMap<String, Long>>()
        for (s in stats) {
            if (s.pkg in ignore || s.millis <= 0) continue
            val day = Instant.ofEpochMilli(s.firstMs).atZone(zone).toLocalDate()
            if (!day.isBefore(before)) continue
            val apps = best.getOrPut(day) { HashMap() }
            apps[s.pkg] = maxOf(apps[s.pkg] ?: 0L, s.millis)
        }
        return best
            .mapValues { (_, apps) -> apps.mapValues { (it.value + 500) / 1000 }.filterValues { it > 0 } }
            .filterValues { it.isNotEmpty() }
    }
}
