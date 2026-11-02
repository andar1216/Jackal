package app.valkyrie.phone

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.text.InputType
import android.text.format.DateUtils
import android.view.View
import android.widget.LinearLayout
import java.time.LocalDate
import kotlin.concurrent.thread

/**
 * Settings: how the app looks (`onThemeChanged` redraws the window in the new colours), and this phone's link to Valkyrie:
 * allow usage access, pair with the code from the Screen Time page on the website, and send. After that the phone syncs
 * by itself (see Sync.kt).
 */
class SettingsScreen(activity: Activity, store: Store, private val onThemeChanged: () -> Unit) : Screen(activity, store) {
    override val title = "Settings"
    override val icon = R.drawable.ic_settings

    private val themeBox = android.widget.LinearLayout(activity).apply { orientation = android.widget.LinearLayout.VERTICAL }

    /** Which settings view is open: null is the list, otherwise "theme", "boards", "access" or "connection". */
    private var section: String? = pendingSection.also { pendingSection = null }
    private val listBox = android.widget.LinearLayout(activity).apply { orientation = android.widget.LinearLayout.VERTICAL }

    private val accessStatus = text("")
    private val accessButton = button("Open usage access settings", primary = true) { openUsageAccess() }
    private val serverField = field("Valkyrie address, like sattire.ngrok.dev", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI)
    private val codeField = field("Code from the Screen Time page", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS)
    private val nameField = field("Name for this phone", InputType.TYPE_CLASS_TEXT)
    private val pairMessage = text("", color = BAD)
    private val pairButton = button("Connect", primary = true) { pair() }
    private val connectedText = text("", 15f)
    private val lastText = text("", color = MUTED)
    private val syncButton = button("Sync now", primary = true) { syncInBackground() }
    private val historyButton = button("Send all history again") { syncInBackground(everything = true) }
    private val historyText = text("", 12f, color = MUTED).apply { setPadding(0, dp(6), 0, 0) }

    private val connIntro = android.widget.LinearLayout(activity).apply {
        orientation = android.widget.LinearLayout.VERTICAL
        addView(text("Sends how long you use this phone to your Valkyrie app, over your home Wi-Fi.", color = MUTED).apply { setPadding(dp(4), 0, 0, dp(12)) })
    }
    private val accessCard = card(text("Allow usage access", 17f, bold = true), accessStatus, space(8), accessButton)

    private val pairCard: LinearLayout
    private val connectedCard: LinearLayout

    init {
        column.addView(listBox)
        column.addView(themeBox)
        column.addView(accessCard)
        column.addView(connIntro)

        pairCard = card(
            text("Connect to Valkyrie", 17f, bold = true),
            text("On your computer, open Valkyrie, go to Screen Time and press \"Pair a phone\". Type the address and code it shows.").apply { setPadding(0, dp(4), 0, dp(8)) },
            serverField, codeField, nameField, pairMessage, space(8), pairButton,
        )
        column.addView(pairCard)

        connectedCard = card(
            text("Connected to Valkyrie", 17f, bold = true),
            connectedText, lastText, space(8), syncButton, space(8), historyButton, historyText, space(8),
            button("Let it run in the background") { activity.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) },
            text("It syncs about every half hour, only while your phone can reach Valkyrie. Samsung phones sometimes pause apps you don't open: choose \"Unrestricted\" for Valkyrie under battery settings if syncs stop.", 12f, color = MUTED).apply { setPadding(0, dp(6), 0, dp(8)) },
            button("Unpair this phone") { confirmUnpair() },
        )
        column.addView(connectedCard)
    }

    override fun show() {
        val access = UsageReader.hasAccess(activity)
        accessStatus.text = if (access) "On. Valkyrie can read how long each app is open." else "Off. Valkyrie can't see app time until this is on: find Valkyrie in the list and switch it on."
        accessButton.text = if (access) "Open usage access settings" else "Turn on usage access"

        val inConnection = section == "connection"
        pairCard.visibility = if (inConnection && !store.paired) View.VISIBLE else View.GONE
        connectedCard.visibility = if (inConnection && store.paired) View.VISIBLE else View.GONE
        if (serverField.text.isNullOrBlank()) serverField.setText(store.server)
        if (nameField.text.isNullOrBlank()) nameField.setText(store.deviceName.ifBlank { defaultName() })

        connectedText.text = "${store.deviceName} is paired with ${store.server}"
        val last = store.lastSyncMs
        val when_ = if (last > 0) "Last synced ${DateUtils.getRelativeTimeSpanString(last, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS)}.\n" else ""
        lastText.text = when_ + store.lastMessage
        historyText.text = if (store.historyMessage.isBlank()) "Sends every day this phone still has, not just the last few." else "Last time: ${store.historyMessage}"

        drawTheme()
        drawList()
        applySection()
    }

    /* ---------- The list of settings, and what each opens ---------- */

    override fun back(): Boolean {
        if (section == null) return false
        section = null
        show()
        return true
    }

    /** The first view: the list, as the left menu's profile opens it. */
    fun openList() {
        section = null
        show()
    }

    private fun go(next: String) {
        section = next
        show()
    }

    private fun titleOf(s: String) = when (s) {
        "theme" -> "Color mode"
        "boards" -> "Boards"
        "access" -> "Usage access"
        else -> "Valkyrie connection"
    }

    /** Shows only the view that is open, with a way back at the top when it is not the list. */
    private fun applySection() {
        val open = section
        listBox.visibility = if (open == null) View.VISIBLE else View.GONE
        themeBox.visibility = if (open == "theme" || open == "boards") View.VISIBLE else View.GONE
        accessCard.visibility = if (open == "access") View.VISIBLE else View.GONE
        connIntro.visibility = if (open == "connection") View.VISIBLE else View.GONE
        header.removeAllViews()
        if (open == null) {
            header.visibility = View.GONE
        } else {
            header.visibility = View.VISIBLE
            header.addView(
                row(
                    text("\u2039", 30f, color = ACCENT).apply { setPadding(dp(16), 0, dp(10), dp(4)) },
                    text(titleOf(open), 17f, bold = true),
                ).apply {
                    setPadding(0, dp(10), dp(16), dp(10))
                    setOnClickListener { back() }
                },
            )
        }
    }

    private fun drawList() {
        listBox.removeAllViews()
        val themeName = when (store.theme) {
            "light" -> "Light"
            "dark" -> "Dark"
            else -> "System"
        }
        listBox.addView(profileCard())
        listBox.addView(group(settingRow("Color mode", themeName) { go("theme") }, settingRow("Boards", "") { go("boards") }))
        listBox.addView(
            group(
                settingRow("Usage access", if (UsageReader.hasAccess(activity)) "On" else "Off") { go("access") },
                settingRow("Valkyrie connection", if (store.paired) "Connected" else "Not connected") { go("connection") },
            ),
        )
        if (store.paired) listBox.addView(group(settingRow("Log out", "", danger = true) { confirmUnpair() }))
    }

    /** Their picture (initials in a circle), name and email, as at the bottom of the left menu. */
    private fun profileCard(): View {
        val name = store.profileName.ifBlank { if (store.paired) store.deviceName else "Valkyrie" }
        val email = store.profileEmail.ifBlank { if (store.paired) "" else "Not connected yet" }
        val words = android.widget.LinearLayout(activity).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            addView(text(name, 17f, bold = true))
            if (email.isNotBlank()) addView(text(email, 13f, color = MUTED))
            layoutParams = android.widget.LinearLayout.LayoutParams(0, android.widget.LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        return card(row(avatarView(activity, name, 48), space(0).apply { layoutParams = android.widget.LinearLayout.LayoutParams(dp(14), 1) }, words))
    }

    /** One line of the list: its name, what it is set to, and an arrow. */
    private fun settingRow(label: String, value: String, danger: Boolean = false, onClick: () -> Unit): View =
        row(
            text(label, 16f, color = if (danger) BAD else INK).apply { layoutParams = android.widget.LinearLayout.LayoutParams(0, android.widget.LinearLayout.LayoutParams.WRAP_CONTENT, 1f) },
            *(if (value.isNotBlank()) arrayOf<View>(text(value, 14f, color = MUTED)) else emptyArray()),
            *(if (danger) emptyArray() else arrayOf<View>(text("  \u203A", 22f, color = MUTED))),
        ).apply {
            setPadding(0, dp(14), 0, dp(14))
            setOnClickListener { onClick() }
        }

    /** Rows in one card with a thin line between them. */
    private fun group(vararg rows: View): View {
        val parts = mutableListOf<View>()
        rows.forEachIndexed { i, row ->
            if (i > 0) parts += View(activity).apply {
                setBackgroundColor(Palette.line)
                layoutParams = android.widget.LinearLayout.LayoutParams(android.widget.LinearLayout.LayoutParams.MATCH_PARENT, dp(1))
            }
            parts += row
        }
        return card(*parts.toTypedArray()).apply { setPadding(dp(16), dp(2), dp(16), dp(2)) }
    }

    /* ---------- What the buttons do ---------- */

    private fun openUsageAccess() {
        val own = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS, Uri.parse("package:${activity.packageName}"))
        try {
            activity.startActivity(own)
        } catch (e: Exception) {
            activity.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)) // some phones only open the whole list
        }
    }

    private fun pair() {
        val server = Api.cleanAddress(serverField.text.toString())
        val code = codeField.text.toString().trim()
        val name = nameField.text.toString().trim().ifBlank { defaultName() }
        if (serverField.text.isNullOrBlank() || code.isBlank()) {
            pairMessage.text = "Type the address and the code."
            return
        }
        pairButton.isEnabled = false
        pairMessage.setTextColor(MUTED)
        pairMessage.text = "Connecting..."
        thread {
            try {
                val (token, filedAs) = Api.pair(server, code, name)
                store.server = server
                store.deviceName = filedAs
                store.token = token
                Sync.scheduleAutomatic(activity)
                activity.runOnUiThread {
                    codeField.setText("")
                    pairMessage.text = ""
                    pairButton.isEnabled = true
                    show()
                }
                if (UsageReader.hasAccess(activity)) Sync.run(activity)
                activity.runOnUiThread { show() }
            } catch (e: ApiException) {
                activity.runOnUiThread {
                    pairMessage.setTextColor(BAD)
                    pairMessage.text = e.message
                    pairButton.isEnabled = true
                }
            }
        }
    }

    /** Sends what the phone has now. Also used when the app is opened, to catch up. */
    fun syncInBackground(everything: Boolean = false) {
        syncButton.isEnabled = false
        historyButton.isEnabled = false
        syncButton.text = "Syncing..."
        thread {
            Sync.run(activity, everything)
            activity.runOnUiThread {
                syncButton.isEnabled = true
                historyButton.isEnabled = true
                syncButton.text = "Sync now"
                show()
            }
        }
    }

    private fun confirmUnpair() {
        AlertDialog.Builder(activity)
            .setTitle("Log out of Valkyrie?")
            .setMessage("This unpairs the phone: Valkyrie stops getting its screen time, and the numbers it already has from this phone are removed.")
            .setPositiveButton("Log out") { _, _ ->
                thread {
                    val token = store.token
                    if (token != null) runCatching { Api.unpair(store.server, token) } // if the server can't be reached, remove it from the page there
                    store.forgetPairing()
                    Sync.cancelAutomatic(activity)
                    activity.runOnUiThread {
                        show()
                    }
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    // The name the person gave the phone in Settings ("Galaxy S23"), rather than its model number.
    private fun defaultName() = Settings.Global.getString(activity.contentResolver, "device_name")?.takeIf { it.isNotBlank() } ?: Build.MODEL

    /* ---------- Theme ---------- */

    private fun drawTheme() {
        themeBox.removeAllViews()
        if (section == "theme") drawThemePanel() else if (section == "boards") drawBoardsPanel()
    }

    private fun drawThemePanel() {
        val choices = listOf("system" to "System", "light" to "Light", "dark" to "Dark")
        themeBox.addView(
            panel(
                "Theme",
                row(*choices.map { (key, label) -> chip(label, store.theme == key) { chooseTheme(key) } }.toTypedArray()),
                space(6),
                text(
                    when (store.theme) {
                        "light" -> "Always light."
                        "dark" -> "Always dark."
                        else -> "Follows your phone: ${if (Palette.dark) "dark" else "light"} right now."
                    },
                    12f,
                    color = MUTED,
                ),
            ),
        )
    }

    private fun drawBoardsPanel() {
        themeBox.addView(
            panel(
                "Boards",
                text("Hold a card on any screen and drag it where you want it. It stays there, and comes back after a reinstall.", color = MUTED),
                space(8),
                button("Put every board back in its first place") {
                    boards.reset()
                    drawTheme()
                },
            ),
        )
    }

    private fun chooseTheme(theme: String) {
        if (store.theme == theme) return
        store.theme = theme
        pendingSection = "theme" // the window is built again in the new colours, and comes back to this view
        onThemeChanged()
    }

    companion object {
        /** The view to open when the window is made again (after the theme changes). */
        private var pendingSection: String? = null

        /** Whether the window should be dark, given the person's choice. "system" follows the phone. */
        fun isDark(theme: String, activity: Activity): Boolean = when (theme) {
            "dark" -> true
            "light" -> false
            else -> activity.resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK == android.content.res.Configuration.UI_MODE_NIGHT_YES
        }
    }
}