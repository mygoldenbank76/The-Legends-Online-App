plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("org.openapi.generator") version "7.10.0"
}

// ─────────────────────────────────────────────────────────────────────────────
// Firebase / FCM is OPTIONAL for the native app. The Capacitor module's
// `google-services.json` cannot be reused — it's pinned to package
// `social.thelegendsonline.app` and the gms plugin would fail
// "No matching client found for package name" against our distinct
// `social.thelegendsonline.native_app` applicationId. Until the user
// registers a new Firebase Android app for the native package and drops
// the resulting `google-services.json` into `app/`, we apply the plugin
// conditionally and the runtime guards the FCM token fetch (see
// LegendsApp.registerFcmIfAuthenticated). The app builds and runs fully
// without Firebase — just no push notifications.
// ─────────────────────────────────────────────────────────────────────────────
val hasFirebaseConfig: Boolean = file("google-services.json").exists()
if (hasFirebaseConfig) {
    apply(plugin = "com.google.gms.google-services")
}

// ─────────────────────────────────────────────────────────────────────────────
// versionCode / versionName come from CI env (mirror of the Capacitor APK
// pattern). Local builds default to 1 / 1.0.0-dev.
// ─────────────────────────────────────────────────────────────────────────────
val appVersionCode: Int = (System.getenv("APP_VERSION_CODE") ?: "1").toInt()
val appVersionName: String = System.getenv("APP_VERSION_NAME") ?: "1.0.0-dev"

android {
    namespace = "social.thelegendsonline.native_app"
    compileSdk = 35

    defaultConfig {
        applicationId = "social.thelegendsonline.native_app"
        // Android 8.0+ — required for the runtime constraints around
        // EncryptedSharedPreferences MasterKey AES256-GCM scheme and
        // notification channels (FCM categorisation).
        minSdk = 26
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersionName

        // Backend base URL — overridable via env at build time.
        // Trailing slash REQUIRED for Retrofit baseUrl().
        val backend = System.getenv("BACKEND_BASE_URL") ?: "https://thelegendsonline.social/"
        buildConfigField("String", "BACKEND_BASE_URL", "\"$backend\"")

        vectorDrawables { useSupportLibrary = true }
    }

    signingConfigs {
        create("release") {
            val ksFile = System.getenv("ANDROID_KEYSTORE_FILE")
            if (!ksFile.isNullOrEmpty()) {
                val ks = file(ksFile)
                if (!ks.exists()) {
                    throw GradleException(
                        "ANDROID_KEYSTORE_FILE='$ksFile' but the file does not exist. " +
                            "Refusing to produce an unsigned release APK."
                    )
                }
                storeFile = ks
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
                storeType = "PKCS12"
            }
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            val ksFile = System.getenv("ANDROID_KEYSTORE_FILE")
            if (!ksFile.isNullOrEmpty()) {
                signingConfig = signingConfigs.getByName("release")
            } else {
                gradle.taskGraph.whenReady {
                    if (allTasks.any { it.name.lowercase().contains("assemblerelease") }) {
                        throw GradleException(
                            "Release build requested but ANDROID_KEYSTORE_FILE is unset. " +
                                "Set the keystore env vars or run assembleDebug."
                        )
                    }
                }
            }
        }
        getByName("debug") {
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
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
            excludes += "META-INF/INDEX.LIST"
            excludes += "META-INF/io.netty.versions.properties"
        }
    }

    // Wire the generated kotlinx_serialization DTOs from the shared
    // OpenAPI spec into the main source set (see openApiGenerate task
    // below). One source of truth — the Web app and the native app
    // consume the SAME contract.
    sourceSets {
        getByName("main") {
            kotlin.srcDir(layout.buildDirectory.dir("generated/openapi/src/main/kotlin"))
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenAPI codegen — pulls models from `lib/api-spec/openapi.yaml` so our
// DTOs stay in lockstep with the server contract. We deliberately scope
// generation to `models` only (no api interfaces) — Retrofit interfaces
// are tiny and easier to maintain by hand than to retrofit generator
// templates over.
// ─────────────────────────────────────────────────────────────────────────────
openApiGenerate {
    generatorName.set("kotlin")
    inputSpec.set(rootProject.file("../../lib/api-spec/openapi.yaml").absolutePath)
    outputDir.set(layout.buildDirectory.dir("generated/openapi").get().asFile.absolutePath)
    apiPackage.set("social.thelegendsonline.native_app.data.openapi.api")
    modelPackage.set("social.thelegendsonline.native_app.data.openapi.model")
    globalProperties.set(mapOf("models" to ""))
    typeMappings.set(mapOf("integer" to "kotlin.Long"))
    configOptions.set(mapOf(
        "serializationLibrary" to "kotlinx_serialization",
        "library" to "jvm-retrofit2",
        "useCoroutines" to "true",
        "dateLibrary" to "string",
        "enumPropertyNaming" to "UPPERCASE",
        "omitGradleWrapper" to "true",
    ))
    skipOverwrite.set(false)
}

tasks.named("preBuild") { dependsOn("openApiGenerate") }

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.navigation:navigation-compose:2.8.4")

    // Encrypted secure storage for the JWT (AES256-GCM key wrapped by
    // the Android Keystore). REPLACES plain DataStore for token storage
    // — see TokenStore.kt for the rationale.
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")

    implementation("io.coil-kt.coil3:coil-compose:3.0.4")
    implementation("io.coil-kt.coil3:coil-network-okhttp:3.0.4")

    // Networking
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.jakewharton.retrofit:retrofit2-kotlinx-serialization-converter:1.0.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.9.0")

    // Socket.io client (Java client works fine on Android)
    implementation("io.socket:socket.io-client:2.1.1") {
        exclude(group = "org.json", module = "json")
    }

    // Firebase / FCM — kept on the classpath so the FCM service compiles
    // even when no `google-services.json` is provisioned. Runtime calls
    // are guarded against missing FirebaseApp init.
    implementation(platform("com.google.firebase:firebase-bom:33.6.0"))
    implementation("com.google.firebase:firebase-messaging-ktx")
}
