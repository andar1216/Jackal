plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.valkyrie.phone"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.valkyrie.phone"
        minSdk = 29 // Android 10: the app-opened/closed events used to measure screen time exist from here on (Health Connect needs 26)
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("androidx.drawerlayout:drawerlayout:1.2.0")
    // Reads the exercise sessions other apps (Strong, Google Fit, Samsung Health) save to Health Connect.
    implementation("androidx.health.connect:connect-client:1.1.0")
    testImplementation("junit:junit:4.13.2")
}
