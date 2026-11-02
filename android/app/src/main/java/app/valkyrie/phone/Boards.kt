package app.valkyrie.phone

import kotlin.concurrent.thread
import org.json.JSONArray
import org.json.JSONObject

/**
 * Where the person put the boards (cards) on each screen. Kept on the phone so it shows at once, and sent to the account
 * so it comes back after a reinstall. Each screen is a page named like "phone-diet".
 */
class Boards(private val store: Store) {
    private fun all(): JSONObject = runCatching { JSONObject(store.layouts) }.getOrDefault(JSONObject())

    fun order(page: String): List<String> = BoardMath.parse(all().optJSONArray(page)?.toString())

    /** Remembers the new order of the boards on screen, and sends it on. */
    fun save(page: String, onScreen: List<String>) {
        val merged = BoardMath.merged(order(page), onScreen)
        if (merged == order(page)) return
        store.layouts = all().put(page, JSONArray(merged)).toString()
        store.layoutsUnsent = store.layoutsUnsent + page
        send(page)
    }

    private fun send(page: String) {
        val token = store.token ?: return
        val server = store.server
        val ids = order(page)
        thread {
            try {
                Api.saveLayout(server, token, page, ids)
                store.layoutsUnsent = store.layoutsUnsent - page
            } catch (e: Exception) {
                // Not reachable now: it stays in the unsent list and goes with the next change or the next time the app opens.
            }
        }
    }

    /** Takes in what the account has (so another phone's choices arrive), and sends what it hasn't got yet. */
    fun refresh(changed: () -> Unit) {
        val token = store.token ?: return
        val server = store.server
        thread {
            try {
                val remote = Api.layouts(server, token)
                val unsent = store.layoutsUnsent
                val mine = all()
                var different = false
                for ((page, ids) in remote) {
                    if (page in unsent) continue
                    if (order(page) != ids) {
                        mine.put(page, JSONArray(ids))
                        different = true
                    }
                }
                // A page the account no longer has was put back to the original order.
                for (page in mine.keys().asSequence().toList()) {
                    if (page !in remote && page !in unsent) {
                        mine.remove(page)
                        different = true
                    }
                }
                if (different) {
                    store.layouts = mine.toString()
                    changed()
                }
                unsent.forEach { send(it) }
            } catch (e: Exception) {
                // Offline: the phone's own copy is what shows.
            }
        }
    }

    /** Every screen back in its original order. */
    fun reset() {
        store.layouts = "{}"
        store.layoutsUnsent = emptySet()
        val token = store.token ?: return
        val server = store.server
        thread { runCatching { Api.resetLayouts(server, token) } }
    }
}
