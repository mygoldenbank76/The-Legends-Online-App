package social.thelegendsonline.native_app.data.repo

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Persists the JWT in **AES256-GCM EncryptedSharedPreferences** — the
 * encryption key itself is wrapped by the Android Keystore (hardware
 * StrongBox when available). Plain DataStore was rejected because the
 * file is world-readable to root/ADB on rooted devices and ends up in
 * cloud backups by default.
 *
 * The OkHttp interceptor reads `currentToken` synchronously per request,
 * so we intentionally avoid making every API call a `suspend` function
 * just to fetch a string. SharedPreferences reads are already in-memory
 * after the first load — sub-microsecond cost.
 *
 * State is mirrored into a `MutableStateFlow` so Compose can observe
 * login/logout transitions and recompose the navigation graph (decide
 * Login vs Conversations as the start destination).
 */
class TokenStore(context: Context) {

    private val prefs: SharedPreferences = run {
        val masterKey = MasterKey.Builder(context.applicationContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context.applicationContext,
            FILE_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    @Volatile
    var currentToken: String? = prefs.getString(KEY_TOKEN, null)
        private set

    @Volatile
    var currentUserId: Long? = prefs.getString(KEY_USER_ID, null)?.toLongOrNull()
        private set

    private val _tokenFlow = MutableStateFlow(currentToken)
    val tokenFlow: StateFlow<String?> = _tokenFlow.asStateFlow()

    private val _displayNameFlow = MutableStateFlow(prefs.getString(KEY_DISPLAY_NAME, null))
    val displayNameFlow: StateFlow<String?> = _displayNameFlow.asStateFlow()

    fun save(token: String, userId: Long, displayName: String) {
        currentToken = token
        currentUserId = userId
        prefs.edit()
            .putString(KEY_TOKEN, token)
            .putString(KEY_USER_ID, userId.toString())
            .putString(KEY_DISPLAY_NAME, displayName)
            .apply()
        _tokenFlow.value = token
        _displayNameFlow.value = displayName
    }

    fun clear() {
        currentToken = null
        currentUserId = null
        prefs.edit().clear().apply()
        _tokenFlow.value = null
        _displayNameFlow.value = null
    }

    companion object {
        private const val FILE_NAME = "legends_secure_prefs"
        private const val KEY_TOKEN = "auth_jwt"
        private const val KEY_USER_ID = "auth_user_id"
        private const val KEY_DISPLAY_NAME = "auth_display_name"
    }
}
