package social.thelegendsonline.native_app.data.api

import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import social.thelegendsonline.native_app.BuildConfig
import social.thelegendsonline.native_app.data.repo.TokenStore
import java.util.concurrent.TimeUnit

class ApiClient(baseUrl: String, private val tokenStore: TokenStore) {

    private val json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
        explicitNulls = false
    }

    private val authInterceptor = okhttp3.Interceptor { chain ->
        val req = chain.request()
        val token = tokenStore.currentToken
        val rebuilt = if (!token.isNullOrBlank()) {
            req.newBuilder().addHeader("Authorization", "Bearer $token").build()
        } else req
        chain.proceed(rebuilt)
    }

    private val ok: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .addInterceptor(authInterceptor)
        .apply {
            if (BuildConfig.DEBUG) {
                addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC })
            }
        }
        .build()

    private val retrofit: Retrofit = Retrofit.Builder()
        .baseUrl(baseUrl)
        .client(ok)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()

    val authApi: AuthApi = retrofit.create(AuthApi::class.java)
    val conversationsApi: ConversationsApi = retrofit.create(ConversationsApi::class.java)
    val messagesApi: MessagesApi = retrofit.create(MessagesApi::class.java)

    val okHttpClient: OkHttpClient get() = ok
    val jsonCodec: Json get() = json
}
