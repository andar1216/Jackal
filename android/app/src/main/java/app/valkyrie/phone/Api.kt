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
        val text = request(server, method, path, token, body)
        return if (text.isBlank()) null else JSONObject(text)
    }

    /** The raw answer, since some screens are lists rather than one object. */
    private fun request(server: String, method: String, path: String, token: String?, body: JSONObject? = null, readTimeoutMs: Int = 30_000): String {
        val connection = URL("$server/api/phone$path").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 8_000
            connection.readTimeout = readTimeoutMs
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
            return text
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

    /** Sends the days. Returns the names of apps the server wants a picture of.
     *  `categories` maps an app's name to what Android calls it ("Social"), for the apps it has one for. */
    fun sync(server: String, token: String, days: JSONArray, categories: Map<String, String> = emptyMap()): List<String> {
        val body = JSONObject().put("days", days)
        if (categories.isNotEmpty()) body.put("categories", JSONObject(categories))
        val r = call(server, "POST", "/sync", token, body)!!
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

    /** The name and email of the account this phone belongs to. */
    fun me(server: String, token: String): JSONObject = JSONObject(request(server, "GET", "/app/me", token))

    /* ---------- The phone's own screens: habits, Screen Time, Finances ---------- */

    /** The habits with the days each was done. `today` is this phone's date, so "today" means the same here and there. */
    fun habits(server: String, token: String, today: String): JSONArray =
        JSONArray(request(server, "GET", "/app/habits?today=$today", token))

    /** Puts a day on or off for a habit. */
    fun toggleHabit(server: String, token: String, id: String, date: String) {
        request(server, "POST", "/app/habits/$id/toggle/$date", token, JSONObject())
    }

    /** A new habit, started on `today` (this phone's date). */
    fun addHabit(server: String, token: String, name: String, eliminating: Boolean, today: String) {
        val body = JSONObject().put("name", name).put("kind", if (eliminating) "eliminating" else "performing")
        request(server, "POST", "/app/habits?today=$today", token, body)
    }

    fun renameHabit(server: String, token: String, id: String, name: String) {
        request(server, "PATCH", "/app/habits/$id", token, JSONObject().put("name", name))
    }

    /** Puts a habit away, or brings it back. */
    fun archiveHabit(server: String, token: String, id: String, archived: Boolean) {
        request(server, "PATCH", "/app/habits/$id", token, JSONObject().put("archived", archived))
    }

    fun deleteHabit(server: String, token: String, id: String) {
        request(server, "DELETE", "/app/habits/$id", token)
    }

    /** Meals from `from` on ("2026-10-25"). */
    fun meals(server: String, token: String, from: String): JSONArray = JSONArray(request(server, "GET", "/app/meals?from=$from", token))

    fun addMeal(server: String, token: String, name: String, calories: Int, protein: Int, carbs: Int, fat: Int, day: String) {
        val body = JSONObject().put("name", name).put("calories", calories).put("protein", protein).put("carbs", carbs).put("fat", fat).put("date", day)
        request(server, "POST", "/app/meals", token, body)
    }

    fun deleteMeal(server: String, token: String, id: String) {
        request(server, "DELETE", "/app/meals/$id", token)
    }

    fun workouts(server: String, token: String, from: String): JSONArray = JSONArray(request(server, "GET", "/app/workouts?from=$from", token))

    fun addWorkout(server: String, token: String, type: String, minutes: Int, burned: Int, day: String) {
        val body = JSONObject().put("type", type).put("durationMin", minutes).put("caloriesBurned", burned).put("date", day)
        request(server, "POST", "/app/workouts", token, body)
    }

    fun deleteWorkout(server: String, token: String, id: String) {
        request(server, "DELETE", "/app/workouts/$id", token)
    }

    /** The text of a Strong export (Settings > Export Strong Data). Years of sets can be a few megabytes. */
    fun importStrong(server: String, token: String, csv: String): JSONObject =
        JSONObject(request(server, "POST", "/app/workouts/import-strong", token, JSONObject().put("csv", csv), readTimeoutMs = 120_000))

    /** Exercise sessions read from Health Connect. Each is a JSON object with id, type, date, durationMin and app. */
    fun healthSessions(server: String, token: String, sessions: JSONArray): JSONObject =
        JSONObject(request(server, "POST", "/app/workouts/health", token, JSONObject().put("sessions", sessions), readTimeoutMs = 60_000))

    /** The fitness connectors (Crunch and so on) with whether each is connected, and Crunch's data. */
    fun fitness(server: String, token: String): JSONObject = JSONObject(request(server, "GET", "/app/fitness", token))

    /** Asks the server to refresh Crunch from Crunch's site. Signing in there can take a while. */
    fun syncCrunch(server: String, token: String) {
        request(server, "POST", "/app/fitness/crunch/sync", token, JSONObject(), readTimeoutMs = 120_000)
    }

    /** Where the phone's boards were put, from any phone paired with this account: page to list of board names. */
    fun layouts(server: String, token: String): Map<String, List<String>> {
        val all = JSONObject(request(server, "GET", "/app/layouts", token))
        return all.keys().asSequence().associateWith { page ->
            val items = all.getJSONArray(page)
            List(items.length()) { items.getJSONObject(it).getString("id") }
        }
    }

    fun saveLayout(server: String, token: String, page: String, ids: List<String>) {
        val items = JSONArray(ids.map { JSONObject().put("id", it).put("size", "full").put("hidden", false) })
        request(server, "PUT", "/app/layouts/$page", token, JSONObject().put("items", items))
    }

    /** Puts every screen's boards back in the order they came in. */
    fun resetLayouts(server: String, token: String) {
        request(server, "DELETE", "/app/layouts", token)
    }

    fun screenTime(server: String, token: String): JSONObject = JSONObject(request(server, "GET", "/app/screen-time", token))

    /** Files an app or website under `category`, or back to automatic with null. */
    fun setCategory(server: String, token: String, kind: String, name: String, category: String?) {
        val body = JSONObject().put("kind", kind).put("name", name).put("category", category ?: JSONObject.NULL)
        request(server, "PUT", "/app/screen-time/category", token, body)
    }

    /** `month` is like "2026-11". */
    fun finance(server: String, token: String, month: String): JSONObject =
        JSONObject(request(server, "GET", "/app/finance?month=$month", token))}
