package app.valkyrie.phone

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.text.format.DateUtils
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.time.LocalDate
import kotlin.concurrent.thread

/**
 * The whole app is this one screen: allow usage access, pair with Valkyrie using the code from its Screen Time page,
 * and see that it works. After that it syncs by itself (see Sync.kt).
 */
class MainActivity : Activity() {
    private val accent = Color.parseColor("#4F46E5")
    private lateinit var store: Store

    private lateinit var accessStatus: TextView
    private lateinit var accessButton: Button
    private lateinit var pairCard: LinearLayout
    private lateinit var serverField: EditText
    private lateinit var codeField: EditText
    private lateinit var nameField: EditText
    private lateinit var pairButton: Button
    private lateinit var pairMessage: TextView
    private lateinit var connectedCard: LinearLayout
    private lateinit var connectedText: TextView
    private lateinit var lastText: TextView
    private lateinit var syncButton: Button
    private lateinit var historyButton: Button
    private lateinit var historyText: TextView
    private lateinit var todayText: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = Store(this)
        setContentView(build())
    }

    override fun onResume() {
        super.onResume()
        update()
        // Opening the app is a good moment to catch up.
        if (store.paired && UsageReader.hasAccess(this)) syncInBackground()
    }

    /* ---------- What is on screen ---------- */

    private fun build(): View {
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(20), dp(16), dp(24))
        }

        column.addView(text("Valkyrie", 28f, bold = true, color = accent))
        column.addView(text("Sends how long you use this phone to your Valkyrie app, over your home Wi-Fi.", 14f, color = Color.DKGRAY).apply { setPadding(0, dp(2), 0, dp(12)) })

        accessStatus = text("", 14f)
        accessButton = button("Open usage access settings", primary = true) { openUsageAccess() }
        column.addView(card(text("1. Allow usage access", 17f, bold = true), accessStatus, space(8), accessButton))

        // Before pairing
        serverField = field("Valkyrie address, like sattire.ngrok.dev", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI)
        codeField = field("Code from the Screen Time page", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS)
        nameField = field("Name for this phone", InputType.TYPE_CLASS_TEXT)
        pairMessage = text("", 14f, color = Color.parseColor("#B42318"))
        pairButton = button("Connect", primary = true) { pair() }
        pairCard = card(
            text("2. Connect to Valkyrie", 17f, bold = true),
            text("On your computer, open Valkyrie, go to Screen Time and press \"Pair a phone\". Type the address and code it shows.", 14f).apply { setPadding(0, dp(4), 0, dp(8)) },
            serverField, codeField, nameField, pairMessage, space(8), pairButton,
        )
        column.addView(pairCard)

        // After pairing
        connectedText = text("", 15f)
        lastText = text("", 14f, color = Color.DKGRAY)
        historyText = text("", 12f, color = Color.GRAY).apply { setPadding(0, dp(6), 0, 0) }
        syncButton = button("Sync now", primary = true) { syncInBackground() }
        historyButton = button("Send all history again") { syncInBackground(everything = true) }
        connectedCard = card(
            text("2. Connected to Valkyrie", 17f, bold = true),
            connectedText, lastText, space(8), syncButton, space(8), historyButton, historyText, space(8),
            button("Let it run in the background") { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) },
            text("It syncs about every half hour, only while your phone can reach Valkyrie. Samsung phones sometimes pause apps you don't open: choose \"Unrestricted\" for Valkyrie under battery settings if syncs stop.", 12f, color = Color.GRAY).apply { setPadding(0, dp(6), 0, dp(8)) },
            button("Unpair this phone") { confirmUnpair() },
        )
        column.addView(connectedCard)

        todayText = text("", 14f)
        column.addView(card(text("Today on this phone", 17f, bold = true), space(4), todayText))

        return ScrollView(this).apply {
            setBackgroundColor(Color.parseColor("#F4F4F8"))
            isFillViewport = true
            addView(column)
        }
    }

    private fun update() {
        val access = UsageReader.hasAccess(this)
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

        if (!access) {
            todayText.text = "Turn on usage access to see today's total here."
            return
        }
        thread {
            val summary = try {
                val reading = Sync.readByLabel(this, 1)
                val today = reading.days[LocalDate.now()] ?: emptyMap()
                val total = today.values.sum()
                val unlocks = reading.unlocks[LocalDate.now()] ?: 0
                val notifications = reading.notifications[LocalDate.now()]?.values?.sum() ?: 0
                val counts = "Unlocks: $unlocks   Notifications: $notifications"
                if (total == 0L) "Nothing counted yet today.\n$counts" else
                    "Total: ${duration(total)}\n$counts\n" + today.entries.sortedByDescending { it.value }.take(6).joinToString("\n") { "${it.key}  ${duration(it.value)}" }
            } catch (e: Exception) {
                "Couldn't read usage: ${e.message}"
            }
            runOnUiThread { todayText.text = summary }
        }
    }

    /* ---------- What the buttons do ---------- */

    private fun openUsageAccess() {
        val own = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS, Uri.parse("package:$packageName"))
        try {
            startActivity(own)
        } catch (e: Exception) {
            startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)) // some phones only open the whole list
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
        pairMessage.setTextColor(Color.DKGRAY)
        pairMessage.text = "Connecting..."
        thread {
            try {
                val (token, filedAs) = Api.pair(server, code, name)
                store.server = server
                store.deviceName = filedAs
                store.token = token
                Sync.scheduleAutomatic(this)
                runOnUiThread {
                    codeField.setText("")
                    pairMessage.text = ""
                    pairButton.isEnabled = true
                    update()
                }
                if (UsageReader.hasAccess(this)) Sync.run(this)
                runOnUiThread { update() }
            } catch (e: ApiException) {
                runOnUiThread {
                    pairMessage.setTextColor(Color.parseColor("#B42318"))
                    pairMessage.text = e.message
                    pairButton.isEnabled = true
                }
            }
        }
    }

    private fun syncInBackground(everything: Boolean = false) {
        syncButton.isEnabled = false
        historyButton.isEnabled = false
        syncButton.text = "Syncing..."
        thread {
            Sync.run(this, everything)
            runOnUiThread {
                syncButton.isEnabled = true
                historyButton.isEnabled = true
                syncButton.text = "Sync now"
                update()
            }
        }
    }

    private fun confirmUnpair() {
        AlertDialog.Builder(this)
            .setTitle("Unpair this phone?")
            .setMessage("Valkyrie stops getting this phone's screen time, and the numbers it already has from this phone are removed.")
            .setPositiveButton("Unpair") { _, _ ->
                thread {
                    val token = store.token
                    if (token != null) runCatching { Api.unpair(store.server, token) } // if the server can't be reached, remove it from the page there
                    store.forgetPairing()
                    Sync.cancelAutomatic(this)
                    runOnUiThread { update() }
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    /* ---------- Small helpers ---------- */

    // The name the person gave the phone in Settings ("Galaxy S23"), rather than its model number.
    private fun defaultName() = Settings.Global.getString(contentResolver, "device_name")?.takeIf { it.isNotBlank() } ?: Build.MODEL

    private fun duration(seconds: Long): String {
        val minutes = (seconds + 30) / 60
        return when {
            seconds in 1..29 -> "<1m"
            minutes >= 60 -> "${minutes / 60}h ${minutes % 60}m"
            else -> "${minutes}m"
        }
    }

    private fun dp(n: Int) = (n * resources.displayMetrics.density).toInt()

    private fun space(n: Int) = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, dp(n)) }

    private fun text(s: String, size: Float, bold: Boolean = false, color: Int = Color.parseColor("#222222")) = TextView(this).apply {
        text = s
        textSize = size
        setTextColor(color)
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
    }

    private fun field(hint: String, type: Int) = EditText(this).apply {
        this.hint = hint
        inputType = type
        setSingleLine()
    }

    private fun button(label: String, primary: Boolean = false, onClick: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        gravity = Gravity.CENTER
        if (primary) {
            backgroundTintList = ColorStateList.valueOf(accent)
            setTextColor(Color.WHITE)
        }
        setOnClickListener { onClick() }
    }

    private fun card(vararg children: View) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(16), dp(14), dp(16), dp(16))
        background = GradientDrawable().apply {
            setColor(Color.WHITE)
            cornerRadius = dp(14).toFloat()
        }
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(12) }
        children.forEach { addView(it) }
    }
}
