package app.valkyrie.phone

import android.app.Activity
import android.content.ClipData
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.DragEvent
import android.view.Gravity
import android.view.HapticFeedbackConstants
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

    /** Stays at the top while the rest scrolls. Empty (and out of the way) unless a screen puts something in it. */
    protected val header = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(Palette.background)
        visibility = View.GONE
    }

    private val scroll = ScrollView(activity).apply {
        isFillViewport = true
        addView(column)
    }

    val root: View = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(Palette.background)
        addView(header, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
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
    protected fun panel(title: String, vararg children: View, id: String = title) =
        card(text(title, 17f, bold = true).apply { setPadding(0, 0, 0, dp(6)) }, *children).board(id)

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

    /* ---------- Boards: hold one and drag it where you want it ---------- */

    protected val boards = Boards(store)
    private var dragged: View? = null
    private var dragY = 0f
    private var edgeStep = 0
    private var scrolling = false

    /** Marks a card as a board that can be moved. `id` stays the same for good: the saved order remembers it. */
    protected fun <V : View> V.board(id: String): V {
        tag = id
        return this
    }

    /**
     * Puts the boards in `container` (the views marked with board()) in the order the person left them, and lets each be
     * held down and dragged to a new place. Where it lands is saved under `page`. Other views stay where they are.
     * Call it each time the container has been filled.
     */
    protected fun arrange(page: String, container: LinearLayout) {
        val slots = (0 until container.childCount).filter { container.getChildAt(it).tag is String }
        val views = slots.map { container.getChildAt(it) }
        val ids = views.map { it.tag as String }
        if (views.isEmpty() || ids.toSet().size != ids.size) return

        val byId = views.associateBy { it.tag as String }
        views.forEach { container.removeView(it) }
        BoardMath.arranged(ids, boards.order(page)).forEachIndexed { i, id -> container.addView(byId.getValue(id), slots[i]) }

        if (views.size < 2) return
        views.forEach { view ->
            view.setOnLongClickListener {
                dragged = view
                view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
                view.startDragAndDrop(ClipData.newPlainText("board", view.tag as String), View.DragShadowBuilder(view), DRAG_MARK, 0)
                view.alpha = 0.35f // the board being moved fades, and its picture follows the finger
                true
            }
        }
        container.setOnDragListener { _, event ->
            when (event.action) {
                DragEvent.ACTION_DRAG_STARTED -> event.localState === DRAG_MARK && dragged?.parent === container
                DragEvent.ACTION_DRAG_LOCATION -> {
                    dragY = event.y
                    reorder(container)
                    edgeScroll(container)
                    true
                }
                DragEvent.ACTION_DROP -> true
                DragEvent.ACTION_DRAG_ENDED -> {
                    val view = dragged
                    if (view?.parent === container) {
                        view.alpha = 1f
                        edgeStep = 0
                        boards.save(page, (0 until container.childCount).mapNotNull { container.getChildAt(it).tag as? String })
                    }
                    dragged = null
                    true
                }
                else -> false
            }
        }
    }

    /** Moves the held board past the one under the finger once the finger is over that one's middle. */
    private fun reorder(container: LinearLayout) {
        val held = dragged ?: return
        val from = container.indexOfChild(held)
        for (i in 0 until container.childCount) {
            val other = container.getChildAt(i)
            if (other === held || other.tag !is String || dragY < other.top || dragY > other.bottom) continue
            val middle = (other.top + other.bottom) / 2
            if ((i > from && dragY > middle) || (i < from && dragY < middle)) {
                container.removeView(held)
                container.addView(held, i)
            }
            return
        }
    }

    /** Near the top or bottom of the screen the page scrolls by itself, so a board can be taken a long way. */
    private fun edgeScroll(container: LinearLayout) {
        val at = IntArray(2)
        val within = IntArray(2)
        container.getLocationOnScreen(at)
        scroll.getLocationOnScreen(within)
        val y = at[1] + dragY - within[1]
        val edge = dp(110)
        edgeStep = when {
            y < edge -> -dp(12)
            y > scroll.height - edge -> dp(12)
            else -> 0
        }
        if (edgeStep == 0 || scrolling) return
        scrolling = true
        container.post(object : Runnable {
            override fun run() {
                if (dragged == null || edgeStep == 0) {
                    scrolling = false
                    return
                }
                val before = scroll.scrollY
                scroll.scrollBy(0, edgeStep)
                dragY += scroll.scrollY - before // the page moved under the finger
                reorder(container)
                container.postDelayed(this, 16)
            }
        })
    }
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
        private val DRAG_MARK = Any()

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