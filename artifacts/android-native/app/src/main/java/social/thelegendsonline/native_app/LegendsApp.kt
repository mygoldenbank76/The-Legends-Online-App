package social.thelegendsonline.native_app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request

class LegendsApp : Application() {

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    val http = OkHttpClient()

    var jwtToken: String? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        ensureNotificationChannel()
    }

    fun registerFcmIfAuthenticated() {
        val jwt = jwtToken ?: return
        if (FirebaseApp.getApps(this).isEmpty()) return
        appScope.launch {
            runCatching {
                val fcmToken = FirebaseMessaging.getInstance().token.await()
                if (!fcmToken.isNullOrBlank()) {
                    val body = FormBody.Builder()
                        .add("token", fcmToken)
                        .add("platform", "android")
                        .build()
                    val req = Request.Builder()
                        .url("${BuildConfig.BACKEND_BASE_URL}api/push/fcm-register")
                        .header("Authorization", "Bearer $jwt")
                        .post(body)
                        .build()
                    http.newCall(req).execute().close()
                }
            }
        }
    }

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = getSystemService(NotificationManager::class.java) ?: return
        val id = getString(R.string.default_notification_channel_id)
        if (mgr.getNotificationChannel(id) != null) return
        val channel = NotificationChannel(
            id,
            getString(R.string.default_notification_channel_name),
            NotificationManager.IMPORTANCE_HIGH,
        )
        mgr.createNotificationChannel(channel)
    }

    companion object {
        @Volatile
        private var instance: LegendsApp? = null
        fun get(): LegendsApp = instance ?: error("LegendsApp not initialised yet")
    }
}
