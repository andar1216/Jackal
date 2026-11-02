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

    val paired get() = !token.isNullOrBlank()

    fun forgetPairing() {
        prefs.edit().remove("token").remove("lastSyncMs").remove("lastMessage").remove("historyDone").apply()
    }
}
