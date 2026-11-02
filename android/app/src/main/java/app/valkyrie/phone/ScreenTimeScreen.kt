package app.valkyrie.phone

import android.app.Activity
import android.app.AlertDialog
import android.view.View
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import org.json.JSONObject

/**
 * Screen Time: what the dashboard page shows, for the phone and the computer together. Apps and websites in one list
 * with their categories (tap one to change it), time by category, notifications, and each day.
 */
class ScreenTimeScreen(activity: Activity, store: Store) : Screen(activity, store) {
    override val title = "Screen Time"
    override val icon = R.drawable.ic_screen_time

    private val content = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
    private var data: JSONObject? = null

    init {
        column.addView(content)
    }

    override fun show() {
        if (data == null) content.addView(text("Loading...", color = MUTED))
        load({ server, token -> Api.screenTime(server, token) }) { result ->
            result.onSuccess {
                data = it
                draw()
            }.onFailure {
                content.removeAllViews()
                content.addView(problem(it.message ?: "Couldn't load Screen Time."))
            }
        }
    }

    private class DayCounts(val unlocks: Int, val notifications: Int)

    private fun draw() {
        val data = data ?: return
        content.removeAllViews()

        val uses = ScreenData.uses(data)
        val filings = ScreenData.filings(data)
        val categorize = ScreenMath.categorizer(filings)
        val today = LocalDate.now()

        // Which device and how many days.
        val devices = uses.map { it.device }.filter { it.isNotBlank() }.distinct().sorted()
        if (store.screenDevice != "all" && store.screenDevice !in devices) store.screenDevice = "all"
        val device = store.screenDevice.takeIf { it != "all" }
        val range = store.screenRange
        val from = ScreenMath.firstDay(range, today)

        content.addView(HorizontalScrollView(activity).apply {
            isHorizontalScrollBarEnabled = false
            addView(row(*(listOf("All devices" to "all") + devices.map { it to it }).map { (label, key) ->
                chip(label, store.screenDevice == key) { store.screenDevice = key; draw() }
            }.toTypedArray()))
        })
        content.addView(space(8))
        content.addView(row(*listOf("Today" to "today", "7 days" to "week", "30 days" to "month").map { (label, key) ->
            chip(label, range == key) { store.screenRange = key; draw() }
        }.toTypedArray()))
        content.addView(space(12))

        val ranked = ScreenMath.mostUsed(uses, device, from, categorize)
        val firstDay = from.toString()

        // Phone unlocks and notifications.
        val counts = phoneCounts(data, device)
        val inRange = counts.filterKeys { it >= firstDay }
        val unlocks = inRange.values.sumOf { it.unlocks }
        val notified = notificationsByApp(data, device, firstDay)
        val notifications = notified.sumOf { it.second }
        val appSeconds = ranked.filter { !it.site }.sumOf { it.seconds }

        content.addView(
            card(
                figures("Screen time" to if (appSeconds > 0) duration(appSeconds) else "0m", "Unlocks" to unlocks.toString(), "Notifications" to notifications.toString()),
                text(if (device == null) "Phones and computers together" else device, 12f, color = MUTED),
            ).board("Totals"),
        )

        content.addView(mostUsedPanel(ranked, categorize))
        content.addView(categoryPanel(ranked))
        if (notified.isNotEmpty()) content.addView(notificationsPanel(notified, notifications))
        content.addView(historyPanel(uses, counts, device, from, today))
        arrange("phone-screen-time", content)
    }

    /* ---------- Most used: apps and websites together ---------- */

    private fun mostUsedPanel(ranked: List<Ranked>, categorize: (Boolean, String) -> Categorized): View {
        if (ranked.isEmpty()) return panel("Most used", text("Nothing recorded for these days.", color = MUTED))
        val top = ranked.first().seconds
        val shown = ranked.take(15).map { r ->
            val kind = (if (r.site) "Website" else "App") + " on " + (if (r.phone) "phone" else "computer")
            val owner = when (r.source) {
                Source.MINE -> r.category + " (yours)"
                else -> r.category
            }
            LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(0, dp(2), 0, dp(2))
                addView(line(r.name, duration(r.seconds), "$owner - $kind"))
                addView(bar(r.seconds, top))
                setOnClickListener { chooseCategory(r) }
            }
        }
        val more = if (ranked.size > 15) listOf(text("and ${ranked.size - 15} more", 12f, color = MUTED)) else emptyList()
        return panel("Most used", text("Tap one to change its category.", 12f, color = MUTED), *(shown + more).toTypedArray())
    }

    private fun chooseCategory(r: Ranked) {
        val automatic = "Automatic"
        val names = listOf(automatic) + Guesses.categories
        AlertDialog.Builder(activity)
            .setTitle("${r.name}: category")
            .setItems(names.toTypedArray()) { _, which ->
                val chosen = if (which == 0) null else names[which]
                load({ server, token -> Api.setCategory(server, token, if (r.site) "site" else "app", r.name, chosen) }) { result ->
                    result.onSuccess { show() }.onFailure { content.addView(problem(it.message ?: "Couldn't change that."), 0) }
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    /* ---------- Time by category ---------- */

    private fun categoryPanel(ranked: List<Ranked>): View {
        val byCategory = ScreenMath.byCategory(ranked)
        if (byCategory.isEmpty()) return panel("By category", text("Nothing recorded for these days.", color = MUTED))
        val total = byCategory.sumOf { it.second }
        val top = byCategory.first().second
        return panel(
            "By category",
            *byCategory.take(10).map { (name, seconds) ->
                LinearLayout(activity).apply {
                    orientation = LinearLayout.VERTICAL
                    addView(line(name, "${duration(seconds)}  ${seconds * 100 / total}%"))
                    addView(bar(seconds, top))
                }
            }.toTypedArray(),
        )
    }

    /* ---------- Notifications ---------- */

    private fun notificationsPanel(notified: List<Pair<String, Int>>, total: Int): View = panel(
        "Phone notifications",
        line("All apps", total.toString(), bold = true),
        *notified.take(10).map { (app, count) -> line(app, count.toString()) }.toTypedArray(),
    )

    /* ---------- Each day ---------- */

    private fun historyPanel(uses: List<Use>, counts: Map<String, DayCounts>, device: String?, from: LocalDate, today: LocalDate): View {
        val label = DateTimeFormatter.ofPattern("EEE, MMM d")
        val days = ScreenMath.perDay(uses, device, from, today).reversed()
        val rows = days.map { (day, seconds) ->
            val c = counts[day.toString()]
            val detail = if (c == null) "" else "${c.unlocks} unlocks, ${c.notifications} notifications"
            line(day.format(label), if (seconds > 0) duration(seconds) else "-", detail)
        }
        return panel("Each day", *rows.toTypedArray())
    }

    /* ---------- Reading the phone's own numbers out of what the server sent ---------- */

    private fun phoneCounts(data: JSONObject, device: String?): Map<String, DayCounts> {
        val list = data.optJSONArray("phoneDays") ?: return emptyMap()
        val sums = HashMap<String, IntArray>()
        for (i in 0 until list.length()) {
            val p = list.getJSONObject(i)
            if (device != null && p.optString("device") != device) continue
            val notifications = p.optJSONArray("notifications")
            var n = 0
            if (notifications != null) for (j in 0 until notifications.length()) n += notifications.getJSONObject(j).optInt("count")
            val sum = sums.getOrPut(p.getString("day")) { IntArray(2) }
            sum[0] += p.optInt("unlocks")
            sum[1] += n
        }
        return sums.mapValues { DayCounts(it.value[0], it.value[1]) }
    }

    private fun notificationsByApp(data: JSONObject, device: String?, firstDay: String): List<Pair<String, Int>> {
        val list = data.optJSONArray("phoneDays") ?: return emptyList()
        val totals = HashMap<String, Int>()
        for (i in 0 until list.length()) {
            val p = list.getJSONObject(i)
            if (p.getString("day") < firstDay || (device != null && p.optString("device") != device)) continue
            val notifications = p.optJSONArray("notifications") ?: continue
            for (j in 0 until notifications.length()) {
                val n = notifications.getJSONObject(j)
                totals.merge(n.getString("app"), n.optInt("count"), Int::plus)
            }
        }
        return totals.entries.sortedByDescending { it.value }.map { it.key to it.value }
    }
}
