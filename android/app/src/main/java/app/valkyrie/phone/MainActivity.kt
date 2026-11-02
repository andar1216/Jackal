package app.valkyrie.phone

import android.app.Activity
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.drawerlayout.widget.DrawerLayout

/**
 * The app: a left menu with the same places as the website (Dashboard, Screen Time, Finances) and Settings, where
 * you change the theme, allow usage access, pair, and send. Once paired, the phone also syncs by itself (see Sync.kt).
 */
class MainActivity : Activity() {
    private lateinit var store: Store
    private lateinit var screens: List<Screen>
    private lateinit var settings: SettingsScreen
    private lateinit var current: Screen

    private lateinit var drawer: DrawerLayout
    private lateinit var holder: FrameLayout
    private lateinit var heading: TextView
    private lateinit var menuItems: List<TextView>

    override fun onCreate(savedInstanceState: Bundle?) {
        // The colours are chosen before anything is built. Changing the theme in Settings opens the window again.
        store = Store(this)
        val dark = SettingsScreen.isDark(store.theme, this)
        Palette.use(dark)
        setTheme(if (dark) android.R.style.Theme_DeviceDefault_NoActionBar else android.R.style.Theme_DeviceDefault_Light_NoActionBar)
        super.onCreate(savedInstanceState)

        settings = SettingsScreen(this, store) { recreate() }
        // The same places as the website's left menu, then Settings, which also holds this phone's link to Valkyrie.
        screens = listOf(
            DashboardScreen(this, store),
            HabitsScreen(this, store),
            FinanceScreen(this, store),
            DietScreen(this, store),
            FitnessScreen(this, store),
            ScreenTimeScreen(this, store),
            settings,
        )
        setContentView(build())
        val before = savedInstanceState?.getInt("screen", -1) ?: -1
        open(screens.getOrNull(before) ?: if (store.paired) screens.first() else settings)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putInt("screen", screens.indexOf(current))
    }

    override fun onResume() {
        super.onResume()
        current.show()
        // Opening the app is a good moment to catch up.
        if (store.paired && UsageReader.hasAccess(this)) settings.syncInBackground()
        // Boards moved on another phone (or the website's account) arrive here.
        Boards(store).refresh { runOnUiThread { current.show() } }
    }

    @Deprecated("Back closes the menu first")
    override fun onBackPressed() {
        if (drawer.isDrawerOpen(Gravity.START)) drawer.closeDrawer(Gravity.START) else super.onBackPressed()
    }

    /* ---------- The window: a top bar, the screen, and the menu on the left ---------- */

    private fun build(): View {
        heading = TextView(this).apply {
            textSize = 20f
            setTextColor(Color.WHITE)
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setPadding(dp(8), 0, 0, 0)
        }
        val menuButton = TextView(this).apply {
            text = "\u2630" // three lines
            textSize = 24f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(dp(16), 0, dp(16), 0)
            setOnClickListener { drawer.openDrawer(Gravity.START) }
        }
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Palette.bar)
            addView(menuButton, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(52)))
            addView(heading)
        }
        holder = FrameLayout(this)
        val main = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(bar, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            addView(holder, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        }

        menuItems = screens.map { screen ->
            TextView(this).apply {
                text = screen.title
                textSize = 16f
                gravity = Gravity.CENTER_VERTICAL
                compoundDrawablePadding = dp(16)
                setCompoundDrawablesRelativeWithIntrinsicBounds(screen.icon, 0, 0, 0)
                setPadding(dp(20), dp(14), dp(20), dp(14))
                setOnClickListener {
                    drawer.closeDrawer(Gravity.START)
                    open(screen)
                }
            }
        }
        val menu = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Palette.card)
            setPadding(0, dp(24), 0, 0)
            addView(TextView(context).apply {
                text = "Valkyrie"
                textSize = 24f
                setTextColor(Palette.accentText)
                setTypeface(typeface, android.graphics.Typeface.BOLD)
                setPadding(dp(20), dp(8), dp(20), dp(16))
            })
            menuItems.forEachIndexed { index, item ->
                // Settings sits apart from the places that mirror the website.
                if (screens[index] === settings) addView(View(context).apply {
                    setBackgroundColor(Palette.line)
                    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(1)).apply { setMargins(dp(20), dp(8), dp(20), dp(8)) }
                })
                addView(item)
            }
        }

        drawer = DrawerLayout(this).apply {
            addView(main, DrawerLayout.LayoutParams(DrawerLayout.LayoutParams.MATCH_PARENT, DrawerLayout.LayoutParams.MATCH_PARENT))
            addView(menu, DrawerLayout.LayoutParams(dp(260), DrawerLayout.LayoutParams.MATCH_PARENT).apply { gravity = Gravity.START })
        }
        return drawer
    }

    private fun open(screen: Screen) {
        current = screen
        holder.removeAllViews()
        holder.addView(screen.root)
        heading.text = screen.title
        drawMenu()
        screen.show()
    }

    /** Marks the screen you are on. */
    private fun drawMenu() {
        screens.forEachIndexed { index, screen ->
            val selected = screen === current
            menuItems[index].apply {
                val color = if (selected) Palette.accentText else Palette.ink
                setTextColor(color)
                compoundDrawableTintList = android.content.res.ColorStateList.valueOf(color) // the icon matches the name
                background = if (selected) GradientDrawable().apply { setColor(Palette.selected) } else null
            }
        }
    }

    private fun dp(n: Int) = (n * resources.displayMetrics.density).toInt()
}
