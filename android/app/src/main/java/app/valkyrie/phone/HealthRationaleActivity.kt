package app.valkyrie.phone

import android.app.Activity
import android.graphics.Typeface
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** What Health Connect shows when it asks why this app wants to read workouts. */
class HealthRationaleActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = (24 * resources.displayMetrics.density).toInt()
        setContentView(
            LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(pad, pad * 2, pad, pad)
                addView(TextView(this@HealthRationaleActivity).apply {
                    text = "Why Valkyrie reads your workouts"
                    textSize = 20f
                    typeface = Typeface.DEFAULT_BOLD
                })
                addView(TextView(this@HealthRationaleActivity).apply {
                    text = "Valkyrie reads the exercise sessions other apps (like Strong) save to Health Connect: what the workout was called, " +
                        "the day, and how long it lasted. They are sent only to your own Valkyrie app, and appear on its Fitness page. " +
                        "Nothing else in Health Connect is read."
                    textSize = 15f
                    setPadding(0, pad / 2, 0, pad)
                })
                addView(Button(this@HealthRationaleActivity).apply {
                    text = "OK"
                    setOnClickListener { finish() }
                })
            },
        )
    }
}
