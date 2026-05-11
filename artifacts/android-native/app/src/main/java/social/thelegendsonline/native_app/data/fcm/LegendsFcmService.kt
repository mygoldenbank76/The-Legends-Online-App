package social.thelegendsonline.native_app.data.fcm

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.FormBody
import okhttp3.Request
import social.thelegendsonline.native_app.BuildConfig
import social.thelegendsonline.native_app.LegendsApp
import social.thelegendsonline.native_app.R

class LegendsFcmService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        val app = runCatching { LegendsApp.get() }.getOrNull() ?: return
        val jwt = app.jwtToken ?: return
        CoroutineScope(Dispatchers.IO).launch {
            runCatching {
                val body = FormBody.Builder()
                    .add("token", token)
                    .add("platform", "android")
                    .build()
                val req = Request.Builder()
                    .url("${BuildConfig.BACKEND_BASE_URL}api/push/fcm-register")
                    .header("Authorization", "Bearer $jwt")
                    .post(body)
                    .build()
                app.http.newCall(req).execute().close()
            }
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val title = message.notification?.title ?: message.data["title"] ?: getString(R.string.app_name)
        val body = message.notification?.body ?: message.data["body"].orEmpty()

        val openIntent = PendingIntent.getActivity(
            this,
            0,
            packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notif = NotificationCompat.Builder(this, getString(R.string.default_notification_channel_id))
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setAutoCancel(true)
            .setContentIntent(openIntent)
            .build()

        val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        mgr.notify(message.messageId?.hashCode() ?: System.currentTimeMillis().toInt(), notif)
    }
}
