package app.valkyrie.phone

import android.app.Activity
import android.text.InputType
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import org.json.JSONArray

/** Reads meals and workouts out of what the server sends. */
object LogData {
    fun meals(list: JSONArray): List<MealEntry> = (0 until list.length()).map { list.getJSONObject(it) }.map {
        MealEntry(it.getString("id"), it.getString("name"), it.optInt("calories"), it.optInt("protein"), it.optInt("carbs"), it.optInt("fat"), it.getString("date"))
    }

    fun workouts(list: JSONArray): List<WorkoutEntry> = (0 until list.length()).map { list.getJSONObject(it) }.map {
        WorkoutEntry(it.getString("id"), it.getString("type"), it.optInt("durationMin"), it.optInt("caloriesBurned"), it.getString("date"))
    }
}

/** Diet: today's calories against the goal and macros, the meals eaten today (add and remove), and the last week. */
class DietScreen(activity: Activity, store: Store) : Screen(activity, store) {
    override val title = "Diet"
    override val icon = R.drawable.ic_diet

    private val content = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
    private var meals: List<MealEntry> = emptyList()
    private var loaded = false

    private val name: EditText = field("Meal", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES)
    private val calories: EditText = field("Calories (kcal)", InputType.TYPE_CLASS_NUMBER)
    private val protein: EditText = field("Protein (g)", InputType.TYPE_CLASS_NUMBER)
    private val carbs: EditText = field("Carbs (g)", InputType.TYPE_CLASS_NUMBER)
    private val fat: EditText = field("Fat (g)", InputType.TYPE_CLASS_NUMBER)

    init {
        column.addView(content)
    }

    override fun show() {
        if (!loaded) content.addView(text("Loading...", color = MUTED))
        val from = LocalDate.now().minusDays(6).toString()
        load({ server, token -> Api.meals(server, token, from) }) { result ->
            result.onSuccess {
                loaded = true
                meals = LogData.meals(it)
                draw()
            }.onFailure {
                content.removeAllViews()
                content.addView(problem(it.message ?: "Couldn't load your meals."))
            }
        }
    }

    private fun draw(message: String? = null) {
        content.removeAllViews()
        if (message != null) content.addView(problem(message))
        val today = LocalDate.now()
        val key = today.toString()
        val todays = meals.filter { it.day == key }
        val eaten = DietMath.eaten(meals, key)
        val left = DietMath.remaining(eaten)

        content.addView(
            card(
                figures("Eaten (goal $CALORIE_GOAL)" to "$eaten kcal", "Left today" to "$left kcal"),
                bar(eaten.toLong(), CALORIE_GOAL.toLong(), if (eaten > CALORIE_GOAL) BAD else ACCENT),
                figures("Protein" to "${todays.sumOf { it.protein }} g", "Carbs" to "${todays.sumOf { it.carbs }} g", "Fat" to "${todays.sumOf { it.fat }} g"),
            ),
        )

        content.addView(addCard())

        content.addView(
            panel(
                "Meals today",
                *if (todays.isEmpty()) arrayOf<View>(text("No meals logged today.", color = MUTED)) else todays.map { mealRow(it) }.toTypedArray(),
            ),
        )

        val label = DateTimeFormatter.ofPattern("EEE, MMM d")
        content.addView(
            panel(
                "Last 7 days",
                *DietMath.lastDays(today).map { day ->
                    val eatenThen = DietMath.eaten(meals, day)
                    line(LocalDate.parse(day).format(label), if (eatenThen > 0) "$eatenThen kcal" else "-")
                }.toTypedArray(),
            ),
        )
    }

    private fun addCard(): View = panel(
        "Add a meal",
        name, calories, protein, carbs, fat, space(6),
        button("Add", primary = true) { add() },
    )

    private fun number(field: EditText) = field.text.toString().trim().toIntOrNull()?.coerceAtLeast(0) ?: 0

    private fun add() {
        val meal = name.text.toString().trim()
        if (meal.isEmpty() || calories.text.isNullOrBlank()) {
            draw("Type what you ate and its calories.")
            return
        }
        val kcal = number(calories)
        val p = number(protein)
        val c = number(carbs)
        val f = number(fat)
        val today = LocalDate.now().toString()
        load({ server, token -> Api.addMeal(server, token, meal, kcal, p, c, f, today) }) { result ->
            result.onSuccess {
                listOf(name, calories, protein, carbs, fat).forEach { it.setText("") }
                show()
            }.onFailure { draw(it.message) }
        }
    }

    private fun mealRow(meal: MealEntry): View {
        val details = line(meal.name, "${meal.calories} kcal", "P ${meal.protein}g  C ${meal.carbs}g  F ${meal.fat}g")
        return row(
            details.apply { layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) },
            text("  Remove", 13f, color = BAD).apply {
                setPadding(dp(8), dp(8), 0, dp(8))
                setOnClickListener {
                    load({ server, token -> Api.deleteMeal(server, token, meal.id) }) { result ->
                        result.onSuccess { show() }.onFailure { draw(it.message) }
                    }
                }
            },
        )
    }
}
