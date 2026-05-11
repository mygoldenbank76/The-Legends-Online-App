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
import social.thelegendsonline.native_app.LegendsApp
import social.thelegendsonline.native_app.MainActivity
import social.thelegendsonline.native_app.R

/**
 * FCM receiver. Wired in the AndroidManifest but only ever instantiated
 * by the OS when Firebase is initialised — i.e. when a matching
 * `app/google-services.json` is provisioned for the native package
 * `social.thelegendsonline.native_app`. Until then, this class compiles
 * and links but is dormant at runtime, and `LegendsApp` skips token
 * registration via the `FirebaseApp.getApps(...).isEmpty()` guard.
 *
 * Server side: registers with `platform: "android"` (the route enum
 * accepts ios/android/web) — no server change needed.
 */
class LegendsFcmService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        // App may not be initialised yet if FCM fires before any UI is up.
        val app = runCatching { LegendsApp.get() }.getOrNull() ?: return
        CoroutineScope(Dispatchers.IO).launch {
            app.authRepo.registerFcmToken(token)
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
