plugins {
    id("com.android.application") version "8.6.1" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "2.0.21" apply false
    // Conditionally applied in `app/build.gradle.kts` only when a
    // matching `app/google-services.json` is provisioned (see README).
    id("com.google.gms.google-services") version "4.4.2" apply false
}

