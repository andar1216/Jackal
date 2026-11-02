package app.valkyrie.phone

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONArray
import org.json.JSONObject

/** The server said no, or could not be reached (`status` is 0 then). `message` is fit to show on screen. */
class ApiException(val status: Int, message: String) : Exception(message)

/** Talks to the Valkyrie server on your home network. */
object Api {
    /**
     * "192.168.1.94:4000" -> "http://192.168.1.94:4000", and "sattire.ngrok.dev" -> "https://sattire.ngrok.dev".
     * A web address gets the secure https; a number address on your own network can only be plain http.
     */
    fun cleanAddress(raw: String): String {
        var s = raw.trim().trimEnd('/')
        if (s.endsWith("/api")) s = s.removeSuffix("/api")
        if (!s.startsWith("http://") && !s.startsWith("https://")) {
            val host = s.substringBefore('/').substringBefore(':')
            val onOwnNetwork = host == "localhost" || host.endsWith(".local") || host.matches(Regex("""\d{1,3}(\.\d{1,3}){3}"""))
            s = (if (onOwnNetwork) "http://" else "https://") + s
        }
        return s
    }

    private fun call(server: String, method: String, path: String, token: String?, body: JSONObject? = null): JSONObject? {
        val connection = URL("$server/api/phone$path").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 8_000
            connection.readTimeout = 30_000
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("User-Agent", "Valkyrie-Android/1.0")
            connection.setRequestProperty("ngrok-skip-browser-warning", "true") // ngrok's "you are about to visit" page is for browsers
            if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val code = connection.responseCode
            val text = (if (code in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            if (code !in 200..299) {
                val said = runCatching { JSONObject(text).optString("error") }.getOrNull().orEmpty()
                throw ApiException(code, said.ifBlank { "The server answered $code." })
            }
            return if (text.isBlank()) null else JSONObject(text)
        } catch (e: IOException) {
            throw ApiException(0, "Can't reach $server. Is Valkyrie running (and ngrok, if you use it), and can this phone reach it?")
        } finally {
            connection.disconnect()
        }
    }

    /** Trades the code from the Screen Time page for this phone's key. Returns the key and the name it was filed under. */
    fun pair(server: String, code: String, name: String): Pair<String, String> {
        val r = call(server, "POST", "/pair", null, JSONObject().put("code", code).put("name", name))!!
        return r.getString("token") to r.getString("name")
    }

    /** Sends the days. Returns the names of apps the server wants a picture of. */
    fun sync(server: String, token: String, days: JSONArray): List<String> {
        val r = call(server, "POST", "/sync", token, JSONObject().put("days", days))!!
        val wanted = r.optJSONArray("wantIcons") ?: JSONArray()
        return List(wanted.length()) { wanted.getString(it) }
    }

    /** `icons` maps an app's name to its picture as base64 PNG. */
    fun icons(server: String, token: String, icons: Map<String, String>) {
        call(server, "POST", "/icons", token, JSONObject().put("icons", JSONObject(icons)))
    }

    fun unpair(server: String, token: String) {
        call(server, "DELETE", "/me", token)
    }
}
