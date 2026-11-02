package app.valkyrie.phone

import android.app.Activity
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kotlin.concurrent.thread

/** One screen of the app, shown in the middle of the window. The left menu picks which one. */
abstract class Screen(val activity: Activity, val store: Store) {
    abstract val title: String

    /** The column the screen puts its cards in. */
    protected val column = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(16), dp(12), dp(16), dp(24))
    }

    val root: View = ScrollView(activity).apply {
        setBackgroundColor(BACKGROUND)
        isFillViewport = true
        addView(column)
    }

    /** Called each time the screen comes into view, or the app is opened again. Reload what it shows. */
    abstract fun show()

    /* ---------- Reaching the server without freezing the screen ---------- */

    /** Runs `work` away from the screen, then `done` on it. A server problem arrives as its message. */
    protected fun <T> load(work: (server: String, token: String) -> T, done: (Result<T>) -> Unit) {
        val server = store.server
        val token = store.token
        if (token == null) {
            done(Result.failure(ApiException(0, "This phone isn't connected yet. Open \"This phone\" in the menu to connect it.")))
            return
        }
        thread {
            val result = try {
                Result.success(work(server, token))
            } catch (e: ApiException) {
                Result.failure(e)
            } catch (e: Exception) {
                Result.failure(ApiException(0, "Couldn't read what the server sent: ${e.message}"))
            }
            activity.runOnUiThread { done(result) }
        }
    }

    /* ---------- Building blocks ---------- */

    protected fun dp(n: Int) = (n * activity.resources.displayMetrics.density).toInt()

    protected fun space(n: Int) = View(activity).apply { layoutParams = LinearLayout.LayoutParams(1, dp(n)) }

    protected fun text(s: String, size: Float = 14f, bold: Boolean = false, color: Int = INK) = TextView(activity).apply {
        text = s
        textSize = size
        setTextColor(color)
        if (bold) setTypeface(typeface, Typeface.BOLD)
    }

    protected fun field(hint: String, type: Int) = EditText(activity).apply {
        this.hint = hint
        inputType = type
        setSingleLine()
    }

    protected fun button(label: String, primary: Boolean = false, onClick: () -> Unit) = Button(activity).apply {
        text = label
        isAllCaps = false
        gravity = Gravity.CENTER
        if (primary) {
            backgroundTintList = ColorStateList.valueOf(ACCENT)
            setTextColor(Color.WHITE)
        }
        setOnClickListener { onClick() }
    }

    /** A small pill to pick one of a few choices. */
    protected fun chip(label: String, selected: Boolean, onClick: () -> Unit) = TextView(activity).apply {
        text = label
        textSize = 13f
        setPadding(dp(12), dp(6), dp(12), dp(6))
        setTextColor(if (selected) Color.WHITE else INK)
        background = GradientDrawable().apply {
            setColor(if (selected) ACCENT else Color.parseColor("#E7E7EF"))
            cornerRadius = dp(16).toFloat()
        }
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { rightMargin = dp(8) }
        setOnClickListener { onClick() }
    }

    protected fun row(vararg children: View) = LinearLayout(activity).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        children.forEach { addView(it) }
    }

    /** A row with a name on the left and a figure on the right. */
    protected fun line(left: String, right: String, subtitle: String = "", bold: Boolean = false, rightColor: Int = INK): View {
        val name = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            addView(text(left, 14f, bold))
            if (subtitle.isNotBlank()) addView(text(subtitle, 12f, color = MUTED))
        }
        return row(
            name.apply { layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) },
            text(right, 14f, bold, rightColor),
        ).apply { setPadding(0, dp(5), 0, dp(5)) }
    }

    protected fun card(vararg children: View) = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(16), dp(14), dp(16), dp(16))
        background = GradientDrawable().apply {
            setColor(Color.WHITE)
            cornerRadius = dp(14).toFloat()
        }
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(12) }
        children.forEach { addView(it) }
    }

    /** A card title and then what goes in it. */
    protected fun panel(title: String, vararg children: View) = card(text(title, 17f, bold = true).apply { setPadding(0, 0, 0, dp(6)) }, *children)

    /** Two or three small figures side by side. */
    protected fun figures(vararg pairs: Pair<String, String>) = row(
        *pairs.map { (label, value) ->
            LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                addView(text(value, 20f, bold = true))
                addView(text(label, 12f, color = MUTED))
            }
        }.toTypedArray(),
    ).apply { setPadding(0, dp(4), 0, dp(4)) }

    /** A horizontal bar showing `part` of `whole`. */
    protected fun bar(part: Long, whole: Long, color: Int = ACCENT) = LinearLayout(activity).apply {
        orientation = LinearLayout.HORIZONTAL
        val share = if (whole <= 0) 0f else (part.toFloat() / whole).coerceIn(0f, 1f)
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(6)).apply { bottomMargin = dp(4) }
        background = GradientDrawable().apply { setColor(Color.parseColor("#ECECF3")); cornerRadius = dp(3).toFloat() }
        addView(View(activity).apply {
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, share)
            background = GradientDrawable().apply { setColor(color); cornerRadius = dp(3).toFloat() }
        })
        addView(View(activity).apply { layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f - share) })
    }

    protected fun problem(message: String) = card(text(message, 14f, color = BAD))

    companion object {
        val ACCENT = Color.parseColor("#4F46E5")
        val INK = Color.parseColor("#222222")
        val MUTED = Color.parseColor("#6B7280")
        val BAD = Color.parseColor("#B42318")
        val GOOD = Color.parseColor("#15803D")
        val BACKGROUND = Color.parseColor("#F4F4F8")

        /** "1h 5m", "12m", "<1m". */
        fun duration(seconds: Long): String {
            val minutes = (seconds + 30) / 60
            return when {
                seconds in 1..29 -> "<1m"
                minutes >= 60 -> "${minutes / 60}h ${minutes % 60}m"
                else -> "${minutes}m"
            }
        }
    }
}
