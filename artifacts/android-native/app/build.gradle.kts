plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val hasFirebaseConfig: Boolean = file("google-services.json").exists()
if (hasFirebaseConfig) {
    apply(plugin = "com.google.gms.google-services")
}

val appVersionCode: Int = (System.getenv("APP_VERSION_CODE") ?: "1").toInt()
val appVersionName: String = System.getenv("APP_VERSION_NAME") ?: "1.0.0-dev"

android {
    namespace = "social.thelegendsonline.native_app"
    compileSdk = 35

    defaultConfig {
        applicationId = "social.thelegendsonline.native_app"
        minSdk = 26
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersionName

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
        buildConfig = true
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")

    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.9.0")

    implementation(platform("com.google.firebase:firebase-bom:33.6.0"))
    implementation("com.google.firebase:firebase-messaging-ktx")
}
