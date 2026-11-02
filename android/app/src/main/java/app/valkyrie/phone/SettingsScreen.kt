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

    private val pairCard: LinearLayout
    private val connectedCard: LinearLayout

    init {
        column.addView(themeBox)
        column.addView(text("This phone and Valkyrie", 17f, bold = true).apply { setPadding(dp(4), dp(4), 0, 0) })
        column.addView(text("Sends how long you use this phone to your Valkyrie app, over your home Wi-Fi.", color = MUTED).apply { setPadding(dp(4), 0, 0, dp(12)) })
        column.addView(card(text("1. Allow usage access", 17f, bold = true), accessStatus, space(8), accessButton))

        pairCard = card(
            text("2. Connect to Valkyrie", 17f, bold = true),
            text("On your computer, open Valkyrie, go to Screen Time and press \"Pair a phone\". Type the address and code it shows.").apply { setPadding(0, dp(4), 0, dp(8)) },
            serverField, codeField, nameField, pairMessage, space(8), pairButton,
        )
        column.addView(pairCard)

        connectedCard = card(
            text("2. Connected to Valkyrie", 17f, bold = true),
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

        pairCard.visibility = if (store.paired) View.GONE else View.VISIBLE
        connectedCard.visibility = if (store.paired) View.VISIBLE else View.GONE
        if (serverField.text.isNullOrBlank()) serverField.setText(store.server)
        if (nameField.text.isNullOrBlank()) nameField.setText(store.deviceName.ifBlank { defaultName() })

        connectedText.text = "${store.deviceName} is paired with ${store.server}"
        val last = store.lastSyncMs
        val when_ = if (last > 0) "Last synced ${DateUtils.getRelativeTimeSpanString(last, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS)}.\n" else ""
        lastText.text = when_ + store.lastMessage
        historyText.text = if (store.historyMessage.isBlank()) "Sends every day this phone still has, not just the last few." else "Last time: ${store.historyMessage}"

        drawTheme()
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
            .setTitle("Unpair this phone?")
            .setMessage("Valkyrie stops getting this phone's screen time, and the numbers it already has from this phone are removed.")
            .setPositiveButton("Unpair") { _, _ ->
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

    private fun chooseTheme(theme: String) {
        if (store.theme == theme) return
        store.theme = theme
        onThemeChanged()
    }

    companion object {
        /** Whether the window should be dark, given the person's choice. "system" follows the phone. */
        fun isDark(theme: String, activity: Activity): Boolean = when (theme) {
            "dark" -> true
            "light" -> false
            else -> activity.resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK == android.content.res.Configuration.UI_MODE_NIGHT_YES
        }
    }
}