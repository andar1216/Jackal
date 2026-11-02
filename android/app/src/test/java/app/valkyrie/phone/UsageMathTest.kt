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
}
