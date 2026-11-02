package app.valkyrie.phone

import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class UsageMathTest {
    private val zone = ZoneId.of("America/New_York")
    private val day1 = LocalDate.of(2026, 10, 31)
    private val day2 = LocalDate.of(2026, 11, 1)

    private fun at(day: LocalDate, hour: Int, minute: Int = 0) = day.atTime(hour, minute).atZone(zone).toInstant().toEpochMilli()
    private val start = at(day1, 0)
    private val end = at(day2, 23, 59)

    private fun totals(events: List<Ev>, ignore: Set<String> = emptySet(), to: Long = end) = UsageMath.totals(events, start, to, zone, ignore)

    @Test
    fun countsTimeBetweenOpeningAndLeavingAnApp() {
        val result = totals(listOf(Ev(at(day1, 9), UsageMath.RESUMED, "yt"), Ev(at(day1, 10), UsageMath.PAUSED, "yt")))
        assertEquals(mapOf("yt" to 3600L), result[day1])
    }

    @Test
    fun addsUpSeveralVisitsAndSeveralApps() {
        val result = totals(
            listOf(
                Ev(at(day1, 9), UsageMath.RESUMED, "yt"),
                Ev(at(day1, 9, 10), UsageMath.PAUSED, "yt"),
                Ev(at(day1, 9, 10), UsageMath.RESUMED, "maps"),
                Ev(at(day1, 9, 15), UsageMath.PAUSED, "maps"),
                Ev(at(day1, 12), UsageMath.RESUMED, "yt"),
                Ev(at(day1, 12, 5), UsageMath.PAUSED, "yt"),
            ),
        )
        assertEquals(mapOf("yt" to 900L, "maps" to 300L), result[day1])
    }

    @Test
    fun switchingBetweenScreensOfOneAppIsNotCountedTwice() {
        // The first screen pauses at the very moment the second resumes.
        val result = totals(
            listOf(
                Ev(at(day1, 9), UsageMath.RESUMED, "chat"),
                Ev(at(day1, 9, 30), UsageMath.PAUSED, "chat"),
                Ev(at(day1, 9, 30), UsageMath.RESUMED, "chat"),
                Ev(at(day1, 10), UsageMath.PAUSED, "chat"),
            ),
        )
        assertEquals(mapOf("chat" to 3600L), result[day1])
    }

    @Test
    fun anotherAppTakingOverEndsTheFirstEvenWithoutAPauseEvent() {
        val result = totals(
            listOf(
                Ev(at(day1, 9), UsageMath.RESUMED, "a"),
                Ev(at(day1, 9, 20), UsageMath.RESUMED, "b"),
                Ev(at(day1, 9, 30), UsageMath.PAUSED, "b"),
            ),
        )
        assertEquals(mapOf("a" to 1200L, "b" to 600L), result[day1])
    }

    @Test
    fun theScreenTurningOffStopsTheClock() {
        val result = totals(listOf(Ev(at(day1, 22), UsageMath.RESUMED, "yt"), Ev(at(day1, 22, 30), UsageMath.SCREEN_OFF, "android")))
        assertEquals(mapOf("yt" to 1800L), result[day1])
    }

    @Test
    fun timePastMidnightGoesToTheNextDay() {
        val result = totals(listOf(Ev(at(day1, 23, 30), UsageMath.RESUMED, "yt"), Ev(at(day2, 0, 45), UsageMath.PAUSED, "yt")))
        assertEquals(mapOf("yt" to 1800L), result[day1])
        assertEquals(mapOf("yt" to 2700L), result[day2])
    }

    @Test
    fun anAppStillOpenCountsUntilNow() {
        val now = at(day2, 14)
        val result = totals(listOf(Ev(at(day2, 13, 30), UsageMath.RESUMED, "yt")), to = now)
        assertEquals(mapOf("yt" to 1800L), result[day2])
    }

    @Test
    fun ignoresTheHomeScreenAndWhatHappenedBeforeTheRange() {
        val result = totals(
            listOf(
                Ev(at(day1, 8), UsageMath.RESUMED, "home"),
                Ev(at(day1, 9), UsageMath.PAUSED, "home"),
                // Started the evening before the range and paused one hour into it.
                Ev(start - 3_600_000, UsageMath.RESUMED, "yt"),
                Ev(start + 3_600_000, UsageMath.PAUSED, "yt"),
            ),
            ignore = setOf("home"),
        )
        assertEquals(mapOf("yt" to 3600L), result[day1])
    }

    @Test
    fun aPauseForAnAppThatIsNotOnScreenIsIgnored() {
        val result = totals(listOf(Ev(at(day1, 9), UsageMath.PAUSED, "ghost"), Ev(at(day1, 10), UsageMath.RESUMED, "yt"), Ev(at(day1, 10, 10), UsageMath.PAUSED, "yt")))
        assertEquals(mapOf("yt" to 600L), result[day1])
    }

    @Test
    fun nothingHappenedMeansNothingCounted() {
        assertTrue(totals(emptyList()).isEmpty())
    }

    @Test
    fun countsUnlocksAndEachAppsNotificationsPerDay() {
        val result = UsageMath.counts(
            listOf(
                Ev(at(day1, 8), UsageMath.UNLOCK, "android"),
                Ev(at(day1, 9), UsageMath.UNLOCK, "android"),
                Ev(at(day1, 9, 5), UsageMath.NOTIFICATION, "msgs"),
                Ev(at(day1, 9, 6), UsageMath.NOTIFICATION, "msgs"),
                Ev(at(day1, 9, 7), UsageMath.NOTIFICATION, "mail"),
                Ev(at(day1, 9, 8), UsageMath.NOTIFICATION, "android"), // the system's own: ignored
                Ev(at(day2, 7), UsageMath.NOTIFICATION, "msgs"),
                Ev(at(day1, 9), UsageMath.RESUMED, "msgs"), // not a count
                Ev(start - 1000, UsageMath.UNLOCK, "android"), // before the range
            ),
            start, end, zone, setOf("android"),
        )
        assertEquals(2, result[day1]!!.unlocks)
        assertEquals(mapOf("msgs" to 2, "mail" to 1), result[day1]!!.notifications)
        assertEquals(0, result[day2]!!.unlocks)
        assertEquals(mapOf("msgs" to 1), result[day2]!!.notifications)
    }

    @Test
    fun olderDaysComeFromAndroidsDailyTotalsAndStopWhereTheLogBegins() {
        val old = LocalDate.of(2026, 9, 1)
        val result = UsageMath.older(
            listOf(
                DailyStat(at(old, 0), "yt", 1_800_000),
                DailyStat(at(old, 0), "yt", 1_500_000), // a second total for the same day: the bigger one counts, not the sum
                DailyStat(at(old, 0), "home", 600_000), // ignored
                DailyStat(at(old, 0), "maps", 0), // nothing on screen
                DailyStat(at(day1, 0), "yt", 900_000), // the log covers this day
            ),
            day1, zone, setOf("home"),
        )
        assertEquals(setOf(old), result.keys)
        assertEquals(mapOf("yt" to 1800L), result[old])
    }

    @Test
    fun aDailyTotalThatStartsLateInTheDayStillLandsOnItsOwnDay() {
        // Android starts a day's total when the phone is first used after midnight, which can be the afternoon.
        val old = LocalDate.of(2026, 9, 1)
        val result = UsageMath.older(listOf(DailyStat(at(old, 15), "yt", 60_000)), day1, zone, emptySet())
        assertEquals(mapOf("yt" to 60L), result[old])
    }
}
