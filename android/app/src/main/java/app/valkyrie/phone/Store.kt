package app.valkyrie.phone

import android.content.Context

/** What the app remembers between runs. The key is only ever sent to your own Valkyrie server. */
class Store(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("valkyrie", Context.MODE_PRIVATE)

    var server: String
        get() = prefs.getString("server", "") ?: ""
        set(value) = prefs.edit().putString("server", value).apply()

    var token: String?
        get() = prefs.getString("token", null)
        set(value) = prefs.edit().putString("token", value).apply()

    var deviceName: String
        get() = prefs.getString("deviceName", "") ?: ""
        set(value) = prefs.edit().putString("deviceName", value).apply()

    /** When the last sync worked, in milliseconds. 0 when there never was one. */
    var lastSyncMs: Long
        get() = prefs.getLong("lastSyncMs", 0L)
        set(value) = prefs.edit().putLong("lastSyncMs", value).apply()

    /** What happened on the last try, in words. */
    var lastMessage: String
        get() = prefs.getString("lastMessage", "") ?: ""
        set(value) = prefs.edit().putString("lastMessage", value).apply()

    /** Whether all the history the phone has was already sent once. */
    var historyDone: Boolean
        get() = prefs.getBoolean("historyDone", false)
        set(value) = prefs.edit().putBoolean("historyDone", value).apply()

    /** What the last pull of all the history found, kept apart so later syncs don't wipe it. */
    var historyMessage: String
        get() = prefs.getString("historyMessage", "") ?: ""
        set(value) = prefs.edit().putString("historyMessage", value).apply()

    /** Which stretch the Screen Time screen shows: today, week or month. */
    var screenRange: String
        get() = prefs.getString("screenRange", "week") ?: "week"
        set(value) = prefs.edit().putString("screenRange", value).apply()

    /** Which device the Screen Time screen shows: "all" or a device's name. */
    var screenDevice: String
        get() = prefs.getString("screenDevice", "all") ?: "all"
        set(value) = prefs.edit().putString("screenDevice", value).apply()

    /** How the app looks: "system" (follow the phone), "light" or "dark". */
    var theme: String
        get() = prefs.getString("theme", "system") ?: "system"
        set(value) = prefs.edit().putString("theme", value).apply()

    /** Where the person put the boards on each screen: page name to a list of board names, as JSON. */
    var layouts: String
        get() = prefs.getString("layouts", "{}") ?: "{}"
        set(value) = prefs.edit().putString("layouts", value).apply()

    /** Pages whose new order hasn't reached the server yet. */
    var layoutsUnsent: Set<String>
        get() = prefs.getStringSet("layoutsUnsent", emptySet()) ?: emptySet()
        set(value) = prefs.edit().putStringSet("layoutsUnsent", value).apply()

    /** Who the phone belongs to, for the profile at the bottom of the menu. Read from the server when the app opens. */
    var profileName: String
        get() = prefs.getString("profileName", "") ?: ""
        set(value) = prefs.edit().putString("profileName", value).apply()

    var profileEmail: String
        get() = prefs.getString("profileEmail", "") ?: ""
        set(value) = prefs.edit().putString("profileEmail", value).apply()

    val paired get() = !token.isNullOrBlank()

    fun forgetPairing() {
        prefs.edit().remove("token").remove("lastSyncMs").remove("lastMessage").remove("historyDone").remove("historyMessage").remove("profileName").remove("profileEmail").apply()
    }
}
