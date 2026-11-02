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
    private lateinit var profileRow: LinearLayout

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
            GoalsScreen(this, store),
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
        loadProfile()
        HealthSync.syncInBackground(this, store)
    }

    @Deprecated("The file picker and Health Connect's permission screen answer here")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: android.content.Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        screens.filterIsInstance<FitnessScreen>().firstOrNull()?.onResult(requestCode, resultCode, data)
    }

    @Deprecated("Back closes the menu first, then steps out of a view inside the screen")
    override fun onBackPressed() {
        when {
            drawer.isDrawerOpen(Gravity.START) -> drawer.closeDrawer(Gravity.START)
            current.back() -> Unit
            else -> super.onBackPressed()
        }
    }

    /** Asks the server whose account this phone belongs to, for the profile at the bottom of the menu. */
    private fun loadProfile() {
        val token = store.token
        if (token.isNullOrBlank()) {
            drawProfile()
            return
        }
        Thread {
            try {
                val me = Api.me(store.server, token)
                store.profileName = me.optString("name")
                store.profileEmail = me.optString("email")
            } catch (_: Exception) {
                // Offline: what was remembered stays.
            }
            runOnUiThread {
                drawProfile()
                if (current === settings) current.show()
            }
        }.start()
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

        profileRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
            setOnClickListener {
                drawer.closeDrawer(Gravity.START)
                settings.openList()
                open(settings)
            }
        }
        drawProfile()

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
            // Settings is not in this list: it opens from the profile at the bottom.
            menuItems.forEachIndexed { index, item -> if (screens[index] !== settings) addView(item) }
            addView(View(context), LinearLayout.LayoutParams(1, 0, 1f)) // pushes the profile to the bottom
            addView(View(context).apply {
                setBackgroundColor(Palette.line)
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(1))
            })
            addView(profileRow)
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

    /** Just the person's picture at the bottom of the menu; tapping it opens Settings. */
    private fun drawProfile() {
        val name = store.profileName.ifBlank { if (store.paired) store.deviceName.ifBlank { "Valkyrie" } else "Valkyrie" }
        profileRow.removeAllViews()
        profileRow.addView(avatarView(this, name, 40))
    }
    /** Marks the screen you are on. */
    private fun drawMenu() {
        profileRow.setBackgroundColor(if (current === settings) Palette.selected else Color.TRANSPARENT)
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
