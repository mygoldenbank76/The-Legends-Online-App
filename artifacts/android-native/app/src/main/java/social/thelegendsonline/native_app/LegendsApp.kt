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
import social.thelegendsonline.native_app.data.api.ApiClient
import social.thelegendsonline.native_app.data.repo.AuthRepository
import social.thelegendsonline.native_app.data.repo.ConversationsRepository
import social.thelegendsonline.native_app.data.repo.MessagesRepository
import social.thelegendsonline.native_app.data.repo.TokenStore
import social.thelegendsonline.native_app.data.socket.RealtimeClient

/**
 * Hand-rolled service locator. We deliberately avoid Hilt/Koin to keep
 * the bootstrap path minimal — the MVP has 3 repos and 1 socket client.
 * Add a DI framework only when the graph grows beyond ~10 services.
 */
class LegendsApp : Application() {

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    lateinit var tokenStore: TokenStore
        private set
    lateinit var apiClient: ApiClient
        private set
    lateinit var authRepo: AuthRepository
        private set
    lateinit var conversationsRepo: ConversationsRepository
        private set
    lateinit var messagesRepo: MessagesRepository
        private set
    lateinit var realtime: RealtimeClient
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        tokenStore = TokenStore(applicationContext)
        apiClient = ApiClient(BuildConfig.BACKEND_BASE_URL, tokenStore)
        authRepo = AuthRepository(apiClient.authApi, tokenStore)
        conversationsRepo = ConversationsRepository(apiClient.conversationsApi)
        messagesRepo = MessagesRepository(apiClient.messagesApi)
        realtime = RealtimeClient(BuildConfig.BACKEND_BASE_URL, tokenStore)

        ensureNotificationChannel()
        registerFcmIfAuthenticated()
    }

    /**
     * Push registration on every authenticated cold start. `onNewToken`
     * only fires when FCM rotates the token (rare); without this hot
     * path, a user who reinstalls/clears data + signs back in would
     * never link their device server-side until the next rotation.
     * Mirror of `use-fcm.ts` web hook (`registerFcmToken` on auth+token).
     *
     * No-op if Firebase wasn't auto-initialised (no
     * `app/google-services.json` provisioned for the native package
     * yet — see app/build.gradle.kts header note). The app remains
     * fully functional, just without push.
     */
    private fun registerFcmIfAuthenticated() {
        if (tokenStore.currentToken.isNullOrBlank()) return
        if (FirebaseApp.getApps(this).isEmpty()) return
        appScope.launch {
            runCatching {
                val token = FirebaseMessaging.getInstance().token.await()
                if (!token.isNullOrBlank()) authRepo.registerFcmToken(token)
            }
        }
    }

    /**
     * Public hook for the login/register flow to immediately register
     * the device once a fresh JWT lands. Avoids the next-cold-start
     * delay for closed-app push delivery.
     */
    fun onAuthenticated() {
        registerFcmIfAuthenticated()
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
