package app.valkyrie.phone

import android.app.Activity
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import java.time.LocalDate
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kotlin.concurrent.thread

/** One screen of the app, shown in the middle of the window. The left menu picks which one. */
abstract class Screen(val activity: Activity, val store: Store) {
    abstract val title: String

    /** The little picture beside the name in the left menu (a drawable in res/drawable). */
    abstract val icon: Int

    /** The column the screen puts its cards in. */
    protected val column = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(16), dp(12), dp(16), dp(24))
    }

    val root: View = ScrollView(activity).apply {
        setBackgroundColor(Palette.background)
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

    /** Adds a view that may still sit in an older card (a form that is drawn again keeps its fields). */
    private fun ViewGroup.addFree(child: View) {
        (child.parent as? ViewGroup)?.removeView(child)
        addView(child)
    }

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
            setColor(if (selected) ACCENT else Palette.chip)
            cornerRadius = dp(16).toFloat()
        }
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { rightMargin = dp(8) }
        setOnClickListener { onClick() }
    }

    protected fun row(vararg children: View) = LinearLayout(activity).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        children.forEach { addFree(it) }
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
            setColor(Palette.card)
            cornerRadius = dp(14).toFloat()
        }
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(12) }
        children.forEach { addFree(it) }
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
        background = GradientDrawable().apply { setColor(Palette.chip); cornerRadius = dp(3).toFloat() }
        addView(View(activity).apply {
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, share)
            background = GradientDrawable().apply { setColor(color); cornerRadius = dp(3).toFloat() }
        })
        addView(View(activity).apply { layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f - share) })
    }

    protected fun problem(message: String) = card(text(message, 14f, color = BAD))

    /** A circle for one day: filled when done, outlined when not (and in the habit's colour for today). */
    protected fun dayCircle(day: LocalDate, on: Boolean, color: Int, isToday: Boolean, size: Int = 34) = TextView(activity).apply {
        text = day.dayOfMonth.toString()
        textSize = 13f
        gravity = Gravity.CENTER
        setTextColor(if (on) Color.WHITE else INK)
        background = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            if (on) setColor(color) else {
                setColor(Palette.card)
                setStroke(dp(1), if (isToday) color else Palette.line)
            }
        }
        layoutParams = LinearLayout.LayoutParams(dp(size), dp(size))
    }

    companion object {
        val ACCENT get() = Palette.accent
        val INK get() = Palette.ink
        val MUTED get() = Palette.muted
        val BAD get() = Palette.bad
        val GOOD get() = Palette.good
        val BACKGROUND get() = Palette.background
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

/** The colours of the app. Light or dark is chosen once when the window opens (see MainActivity). */
object Palette {
    var dark = false
        private set

    var background = 0
    var card = 0
    var ink = 0
    var muted = 0
    var accent = 0
    var accentText = 0
    var bar = 0
    var bad = 0
    var good = 0
    var chip = 0
    var line = 0
    var selected = 0

    fun use(dark: Boolean) {
        this.dark = dark
        fun c(light: String, night: String) = Color.parseColor(if (dark) night else light)
        background = c("#F4F4F8", "#0F1115")
        card = c("#FFFFFF", "#1B1E26")
        ink = c("#222222", "#E6E8EE")
        muted = c("#6B7280", "#9AA1AF")
        accent = c("#4F46E5", "#6366F1")
        accentText = c("#4F46E5", "#A5B4FC")
        bar = c("#4F46E5", "#1E2140")
        bad = c("#B42318", "#F87171")
        good = c("#15803D", "#4ADE80")
        chip = c("#E7E7EF", "#2A2E38")
        line = c("#D4D4DC", "#3A3F4B")
        selected = c("#EEF0FF", "#262A44")
    }

    init { use(false) }
}