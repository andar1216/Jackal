package app.valkyrie.phone

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Test

class PhoneMathTest {
    private val today = LocalDate.of(2026, 11, 1)

    @Test
    fun aStreakEndsTodayOrYesterday() {
        assertEquals(3, HabitMath.streak(setOf("2026-11-01", "2026-10-31", "2026-10-30", "2026-10-28"), today))
        assertEquals(2, HabitMath.streak(setOf("2026-10-31", "2026-10-30"), today)) // today isn't done yet, the run still counts
        assertEquals(0, HabitMath.streak(setOf("2026-10-29"), today))
    }

    @Test
    fun theLastSevenDaysEndToday() {
        val days = HabitMath.lastDays(today)
        assertEquals(7, days.size)
        assertEquals(LocalDate.of(2026, 10, 26), days.first())
        assertEquals(today, days.last())
    }

    @Test
    fun aCategoryYouChoseBeatsAGuessWhichBeatsAndroid() {
        val categorize = ScreenMath.categorizer(
            listOf(
                Filing(false, "YouTube", "Study", "Video"),
                Filing(false, "Mystery", null, "Games"),
            ),
        )
        assertEquals("Study", categorize(false, "YouTube").category)
        assertEquals(Source.MINE, categorize(false, "YouTube").source)
        assertEquals("Social", categorize(false, "Instagram").category)
        assertEquals(Source.GUESS, categorize(false, "Instagram").source)
        assertEquals("Games", categorize(false, "Mystery").category)
        assertEquals(Source.PHONE, categorize(false, "Mystery").source)
        assertEquals("Uncategorized", categorize(false, "Nobody knows").category)
        assertEquals("Video", categorize(true, "m.youtube.com").category)
    }

    @Test
    fun mostUsedJoinsAppsAndWebsitesFromEveryDeviceInTheChosenDays() {
        val uses = listOf(
            Use("Galaxy S23", true, "2026-11-01", "Instagram", false, 600),
            Use("Galaxy S23", true, "2026-10-31", "Instagram", false, 300),
            Use("Galaxy S23", true, "2026-10-01", "Instagram", false, 9000), // too old for a week
            Use("PC", false, "2026-11-01", "youtube.com", true, 1200),
            Use("PC", false, "2026-11-01", "chrome", false, 1500),
        )
        val categorize = ScreenMath.categorizer(emptyList())
        val week = ScreenMath.mostUsed(uses, null, ScreenMath.firstDay("week", today), categorize)
        assertEquals(listOf("chrome", "youtube.com", "Instagram"), week.map { it.name })
        assertEquals(900L, week.last().seconds)

        val phoneToday = ScreenMath.mostUsed(uses, "Galaxy S23", ScreenMath.firstDay("today", today), categorize)
        assertEquals(listOf("Instagram"), phoneToday.map { it.name })
        assertEquals(600L, phoneToday.single().seconds)
    }

    @Test
    fun aComputersBrowserIsNotCountedTwiceInTheCategories() {
        val rows = listOf(
            Ranked("chrome", false, false, 1500, "Browsers", Source.GUESS),
            Ranked("youtube.com", true, false, 1200, "Video", Source.GUESS),
            Ranked("Instagram", false, true, 600, "Social", Source.GUESS),
        )
        assertEquals(listOf("Video" to 1200L, "Social" to 600L), ScreenMath.byCategory(rows))
        // With no websites the browser keeps its own time.
        assertEquals(listOf("Browsers" to 1500L), ScreenMath.byCategory(rows.take(1)))
    }

    @Test
    fun everyDayInTheRangeIsListedEvenWithNothingOnIt() {
        val uses = listOf(Use("PC", false, "2026-10-30", "code", false, 100), Use("PC", false, "2026-10-30", "youtube.com", true, 50))
        val days = ScreenMath.perDay(uses, null, today.minusDays(2), today)
        assertEquals(3, days.size)
        assertEquals(listOf(100L, 0L, 0L), days.map { it.second }) // the website isn't added on top of its browser
        assertEquals(today, days.last().first)
    }

    @Test
    fun moneyShowsDollarsAndCents() {
        assertEquals("$1,234.56", FinanceMath.money(123456))
        assertEquals("-$12.00", FinanceMath.money(-1200))
        assertEquals("$0.05", FinanceMath.money(5))
        assertEquals("$1,000,000.00", FinanceMath.money(100000000))
    }

    @Test
    fun monthsMoveAcrossYears() {
        assertEquals("2026-10", FinanceMath.shift("2026-11", -1))
        assertEquals("2027-01", FinanceMath.shift("2026-12", 1))
        assertEquals("2025-12", FinanceMath.shift("2026-01", -1))
        assertEquals("November 2026", FinanceMath.monthName("2026-11"))
    }
}
