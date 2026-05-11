# Keep Kotlinx Serialization metadata
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class social.thelegendsonline.native_app.**$$serializer { *; }
-keepclassmembers class social.thelegendsonline.native_app.** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}

# OkHttp / Retrofit
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn retrofit2.**
-keepattributes Signature
-keepattributes Exceptions

# Socket.io
-keep class io.socket.** { *; }
-dontwarn io.socket.**
