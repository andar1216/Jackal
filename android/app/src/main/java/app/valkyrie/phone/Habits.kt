package app.valkyrie.phone

import android.app.Activity
import android.graphics.Color
import java.time.LocalDate
import org.json.JSONArray
import org.json.JSONObject

/** A habit as the phone shows it. `done` is the days it was done, as "2026-11-01". */
class Habit(
    val id: String,
    var name: String,
    val color: Int,
    val done: MutableSet<String>,
    val eliminating: Boolean,
    val showStreak: Boolean,
    var archived: Boolean,
    val start: LocalDate,
)

object HabitData {
    fun parse(list: JSONArray): List<Habit> = (0 until list.length()).map { parse(list.getJSONObject(it)) }

    fun parse(h: JSONObject): Habit {
        val logs = h.optJSONArray("logs") ?: JSONArray()
        return Habit(
            id = h.getString("id"),
            name = h.getString("name"),
            color = runCatching { Color.parseColor(h.optString("color", "#4f46e5")) }.getOrDefault(Palette.accent),
            done = (0 until logs.length()).map { logs.getString(it) }.toMutableSet(),
            eliminating = h.optString("kind") == "eliminating",
            showStreak = if (h.has("streakVisible") && !h.isNull("streakVisible")) h.getBoolean("streakVisible") else true,
            archived = h.optBoolean("archived"),
            start = runCatching { LocalDate.parse(h.optString("startDate")) }.getOrDefault(LocalDate.now()),
        )
    }
}

/** A screen that shows habits and lets a day be tapped on or off. */
abstract class HabitScreen(activity: Activity, store: Store) : Screen(activity, store) {
    /**
     * Puts a day on or off. The screen changes at once (`redraw`), and the change is put back, with the reason, if the
     * server doesn't take it.
     */
    protected fun toggle(habit: Habit, day: LocalDate, redraw: () -> Unit, failed: (String) -> Unit) {
        val key = day.toString()
        val wasOn = key in habit.done
        if (wasOn) habit.done.remove(key) else habit.done.add(key)
        redraw()
        load({ server, token -> Api.toggleHabit(server, token, habit.id, key) }) { result ->
            result.onFailure {
                if (wasOn) habit.done.add(key) else habit.done.remove(key)
                redraw()
                failed(it.message ?: "Couldn't save that.")
            }
        }
    }
}
