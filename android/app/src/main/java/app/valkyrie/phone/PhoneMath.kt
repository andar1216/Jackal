package app.valkyrie.phone

import java.time.LocalDate

/** The sums behind the phone's own screens. Plain Kotlin, so they are tested without a phone. */

object HabitMath {
    /** Consecutive days done, ending today (or yesterday, if today isn't done yet). Same rule as the website. */
    fun streak(done: Set<String>, today: LocalDate): Int {
        var day = if (today.toString() in done) today else today.minusDays(1)
        var count = 0
        while (day.toString() in done) {
            count++
            day = day.minusDays(1)
        }
        return count
    }

    /** The longest run of days in a row ever done. */
    fun best(done: Set<String>): Int {
        var best = 0
        var run = 0
        var previous: LocalDate? = null
        for (day in done.map { LocalDate.parse(it) }.sorted()) {
            run = if (previous != null && previous.plusDays(1) == day) run + 1 else 1
            best = maxOf(best, run)
            previous = day
        }
        return best
    }

    /** Days done and days missed since the start. Today isn't missed until it is over. */
    fun onOff(done: Set<String>, start: LocalDate, today: LocalDate): Pair<Int, Int> {
        var on = 0
        var off = 0
        var day = start
        while (!day.isAfter(today)) {
            if (day.toString() in done) on++ else if (day != today) off++
            day = day.plusDays(1)
        }
        return on to off
    }

    /** The last `n` days, oldest first, ending today. */
    fun lastDays(today: LocalDate, n: Int = 7): List<LocalDate> = (n - 1 downTo 0).map { today.minusDays(it.toLong()) }
}

/** One day of one app or website on one device. */
class Use(val device: String, val phone: Boolean, val day: String, val name: String, val site: Boolean, val seconds: Long)

/** What is known about how an app or website is filed: the person's choice, and what Android calls it. */
class Filing(val site: Boolean, val name: String, val mine: String?, val phone: String?)

/** How an app or website got its category. */
enum class Source { MINE, GUESS, PHONE, NONE }

class Categorized(val category: String, val source: Source)

/** One line of "Most used": an app or a website, with its time over the chosen days. */
class Ranked(val name: String, val site: Boolean, val phone: Boolean, val seconds: Long, val category: String, val source: Source)

object ScreenMath {
    const val UNCATEGORIZED = "Uncategorized"

    /** The person's choice first, then a guess from the name, then what Android says. Same order as the website. */
    fun categorizer(filings: List<Filing>): (Boolean, String) -> Categorized {
        val byKey = filings.associateBy { (if (it.site) "site:" else "app:") + it.name }
        return { site, name ->
            val entry = byKey[(if (site) "site:" else "app:") + name]
            val guess = if (site) Guesses.site(name) else Guesses.app(name)
            when {
                entry?.mine != null -> Categorized(entry.mine, Source.MINE)
                guess != null -> Categorized(guess, Source.GUESS)
                entry?.phone != null -> Categorized(entry.phone, Source.PHONE)
                else -> Categorized(UNCATEGORIZED, Source.NONE)
            }
        }
    }

    /** The days to show, as the first day (inclusive): "today", "week" (7 days) or "month" (30 days). */
    fun firstDay(range: String, today: LocalDate): LocalDate = when (range) {
        "today" -> today
        "month" -> today.minusDays(29)
        else -> today.minusDays(6)
    }

    /** Apps and websites together, on one device or all of them, busiest first. */
    fun mostUsed(uses: List<Use>, device: String?, from: LocalDate, categorize: (Boolean, String) -> Categorized): List<Ranked> {
        val first = from.toString()
        return uses
            .filter { it.day >= first && (device == null || it.device == device) }
            .groupBy { Triple(it.site, it.name, it.phone) }
            .map { (key, rows) ->
                val c = categorize(key.first, key.second)
                Ranked(key.second, key.first, key.third, rows.sumOf { it.seconds }, c.category, c.source)
            }
            .filter { it.seconds > 0 }
            .sortedByDescending { it.seconds }
    }

    /**
     * Time by category. A browser on a computer shows up as an app and again as every website in it, so its own time is
     * left out while there are websites (otherwise it counts twice).
     */
    fun byCategory(rows: List<Ranked>): List<Pair<String, Long>> {
        val hasSites = rows.any { it.site }
        return rows
            .filter { !(hasSites && !it.site && !it.phone && it.category == "Browsers") }
            .groupBy { it.category }
            .map { (category, list) -> category to list.sumOf { it.seconds } }
            .sortedByDescending { it.second }
    }

    /** Time per day for the chosen days (oldest first), counting apps only on phones and everything else once. */
    fun perDay(uses: List<Use>, device: String?, from: LocalDate, today: LocalDate): List<Pair<LocalDate, Long>> {
        val rows = uses.filter { device == null || it.device == device }
        // Browsers on a computer are also counted as websites; count the apps, not the sites, so nothing is doubled.
        val byDay = rows.filter { !it.site }.groupBy { it.day }.mapValues { (_, list) -> list.sumOf { it.seconds } }
        val days = generateSequence(from) { it.plusDays(1) }.takeWhile { !it.isAfter(today) }.toList()
        return days.map { it to (byDay[it.toString()] ?: 0L) }
    }
}

object FinanceMath {
    /** "$1,234.56", or "-$12.00". */
    fun money(cents: Long): String {
        val sign = if (cents < 0) "-" else ""
        val abs = Math.abs(cents)
        val dollars = abs / 100
        val grouped = dollars.toString().reversed().chunked(3).joinToString(",").reversed()
        return "$sign$$grouped.${(abs % 100).toString().padStart(2, '0')}"
    }

    /** The month before or after "2026-11", as "2026-10". */
    fun shift(month: String, by: Int): String {
        val (y, m) = month.split('-').map { it.toInt() }
        val total = y * 12 + (m - 1) + by
        return "%04d-%02d".format(total / 12, total % 12 + 1)
    }

    /** "November 2026". */
    fun monthName(month: String): String {
        val (y, m) = month.split('-').map { it.toInt() }
        val name = java.time.Month.of(m).getDisplayName(java.time.format.TextStyle.FULL, java.util.Locale.US)
        return "$name $y"
    }
}

/** The calories a day is measured against, the same as the website's. */
const val CALORIE_GOAL = 2200

class MealEntry(val id: String, val name: String, val calories: Int, val protein: Int, val carbs: Int, val fat: Int, val day: String)

class WorkoutEntry(val id: String, val type: String, val minutes: Int, val burned: Int, val day: String)

object DietMath {
    fun eaten(meals: List<MealEntry>, day: String) = meals.filter { it.day == day }.sumOf { it.calories }

    fun burned(workouts: List<WorkoutEntry>, day: String) = workouts.filter { it.day == day }.sumOf { it.burned }

    /** What is left of the day's goal. Exercise adds calories back, like the website's Fitness page. */
    fun remaining(eaten: Int, burned: Int = 0) = CALORIE_GOAL - eaten + burned

    /** The last `n` days, newest first, ending today. */
    fun lastDays(today: LocalDate, n: Int = 7): List<String> = (0 until n).map { today.minusDays(it.toLong()).toString() }
}

/** The sums behind the Crunch panels on Fitness. Same rules as the website, so the numbers match. */
object CrunchMath {
    const val AVERAGE_WEEKS = 12

    class Progress(val thisWeek: Int, val goal: Int?, val average: Double, val best: Int)

    /** Crunch counts a week from Monday. Looks at the last 12 weeks (this one included) and always divides by 12. */
    fun progress(checkIns: List<LocalDate>, goal: Int?, today: LocalDate): Progress {
        fun monday(day: LocalDate): LocalDate = day.minusDays((day.dayOfWeek.value - 1).toLong())
        val perWeek = checkIns.groupingBy { monday(it) }.eachCount()
        val weeks = (AVERAGE_WEEKS - 1 downTo 0).map { monday(today.minusWeeks(it.toLong())) }
        val counts = weeks.map { perWeek[it] ?: 0 }
        return Progress(counts.last(), goal?.takeIf { it > 0 }, counts.sum().toDouble() / AVERAGE_WEEKS, perWeek.values.maxOrNull() ?: 0)
    }

    /**
     * When something happened, on this phone's clock. Check-ins arrive as "2026-10-30T17:05" (already local), classes as
     * a full timestamp ("2026-10-30T22:00:00.000Z").
     */
    fun time(text: String, zone: java.time.ZoneId = java.time.ZoneId.systemDefault()): java.time.LocalDateTime =
        if (text.endsWith("Z") || Regex("""[+-]\d\d:\d\d$""").containsMatchIn(text)) {
            java.time.OffsetDateTime.parse(text).atZoneSameInstant(zone).toLocalDateTime()
        } else {
            java.time.LocalDateTime.parse(text)
        }
}