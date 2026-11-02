package app.valkyrie.phone

import android.app.Activity
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import java.time.LocalDate
import org.json.JSONObject

/** Finances: net worth and accounts, what the month brought in and spent, where it went, and the latest transactions. */
class FinanceScreen(activity: Activity, store: Store) : Screen(activity, store) {
    override val title = "Finances"
    override val icon = R.drawable.ic_finances

    private val content = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
    private var month = LocalDate.now().toString().take(7)
    private var loaded = false

    // The month and its buttons stay at the top while the rest scrolls.
    private val monthLabel = text("", 17f, bold = true).apply {
        gravity = Gravity.CENTER
        layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
    }
    private val earlier = chip("<", false) { move(-1) }
    private val later = chip(">", false) { move(1) }

    init {
        header.visibility = View.VISIBLE
        header.setPadding(dp(16), dp(12), dp(16), dp(12))
        header.addView(row(earlier.apply { setPadding(dp(18), dp(8), dp(18), dp(8)) }, monthLabel, later.apply { setPadding(dp(18), dp(8), dp(18), dp(8)) }))
        column.addView(content)
        drawHeader()
    }

    private fun drawHeader() {
        monthLabel.text = FinanceMath.monthName(month)
        // The future has nothing in it, so the next month can't be opened from this one.
        val canGoLater = month < LocalDate.now().toString().take(7)
        later.alpha = if (canGoLater) 1f else 0.35f
        later.isEnabled = canGoLater
    }

    private fun move(by: Int) {
        val next = FinanceMath.shift(month, by)
        if (next > LocalDate.now().toString().take(7)) return
        month = next
        drawHeader()
        show()
    }

    override fun show() {
        if (!loaded) content.addView(text("Loading...", color = MUTED))
        val asked = month
        load({ server, token -> Api.finance(server, token, asked) }) { result ->
            result.onSuccess {
                loaded = true
                if (asked == month) draw(it)
            }.onFailure {
                content.removeAllViews()
                content.addView(problem(it.message ?: "Couldn't load Finances."))
            }
        }
    }

    private fun draw(data: JSONObject) {
        content.removeAllViews()
        val net = data.optLong("netCents")
        val withoutBalance = data.optInt("withoutBalance")
        content.addView(
            panel(
                "Net worth",
                text(FinanceMath.money(net), 28f, bold = true, color = if (net < 0) BAD else INK),
                figures("Assets" to FinanceMath.money(data.optLong("assetsCents")), "Debts" to FinanceMath.money(data.optLong("debtsCents"))),
                if (withoutBalance > 0) text("$withoutBalance account${if (withoutBalance == 1) "" else "s"} without a balance left out.", 12f, color = MUTED) else space(0),
            ),
        )

        val income = data.optLong("incomeCents")
        val spent = data.optLong("spentCents")
        content.addView(
            panel(
                FinanceMath.monthName(month),
                figures("Income" to FinanceMath.money(income), "Spent" to FinanceMath.money(spent), "Left" to FinanceMath.money(income - spent)),
                id = "month",
            ),
        )

        val categories = data.optJSONArray("categories")
        if (categories != null && categories.length() > 0) {
            val list = (0 until categories.length()).map { categories.getJSONObject(it) }
            val top = list.first().optLong("cents")
            content.addView(
                panel(
                    "Where it went",
                    *list.take(10).map {
                        LinearLayout(activity).apply {
                            orientation = LinearLayout.VERTICAL
                            addView(line(it.getString("category"), FinanceMath.money(it.optLong("cents"))))
                            addView(bar(it.optLong("cents"), top))
                        }
                    }.toTypedArray(),
                ),
            )
        }

        val accounts = data.optJSONArray("accounts")
        if (accounts != null && accounts.length() > 0) {
            content.addView(
                panel(
                    "Accounts",
                    *(0 until accounts.length()).map { accounts.getJSONObject(it) }.map {
                        val balance = if (it.isNull("balanceCents")) "No balance" else FinanceMath.money(it.optLong("balanceCents"))
                        line(it.getString("name"), balance, it.optString("tag"), rightColor = if (it.optBoolean("debt")) BAD else INK)
                    }.toTypedArray(),
                ),
            )
        }

        val recent = data.optJSONArray("recent")
        content.addView(
            panel(
                "Latest transactions",
                *if (recent == null || recent.length() == 0) arrayOf(text("No transactions yet.", color = MUTED)) else
                    (0 until minOf(recent.length(), 25)).map { recent.getJSONObject(it) }.map {
                        val cents = it.optLong("amountCents")
                        val out = it.optString("type") == "expense" && !it.optBoolean("isRefund")
                        val note = it.optString("note").ifBlank { it.optString("category") }
                        val account = it.optString("accountName")
                        line(note, (if (out) "-" else "+") + FinanceMath.money(cents), "${it.optString("date")}  ${it.optString("category")}${if (account.isBlank()) "" else " - $account"}", rightColor = if (out) INK else GOOD)
                    }.toTypedArray(),
            ),
        )
        arrange("phone-finances", content)
    }
}
