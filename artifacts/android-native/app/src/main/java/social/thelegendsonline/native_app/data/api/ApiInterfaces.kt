package social.thelegendsonline.native_app.data.api

import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import social.thelegendsonline.native_app.data.model.FcmRegisterRequest
import social.thelegendsonline.native_app.data.openapi.model.AuthResponse
import social.thelegendsonline.native_app.data.openapi.model.ConversationSummary
import social.thelegendsonline.native_app.data.openapi.model.LoginBody
import social.thelegendsonline.native_app.data.openapi.model.Message
import social.thelegendsonline.native_app.data.openapi.model.RegisterBody
import social.thelegendsonline.native_app.data.openapi.model.SendMessageBody

interface AuthApi {
    @POST("api/auth/login")
    suspend fun login(@Body body: LoginBody): AuthResponse

    @POST("api/auth/register")
    suspend fun register(@Body body: RegisterBody): AuthResponse

    @POST("api/push/fcm-register")
    suspend fun registerFcm(@Body body: FcmRegisterRequest)
}

interface ConversationsApi {
    @GET("api/conversations")
    suspend fun list(): List<ConversationSummary>
}

interface MessagesApi {
    @GET("api/conversations/{id}/messages")
    suspend fun list(
        @Path("id") conversationId: Long,
        @Query("limit") limit: Long = 50L,
        @Query("before") beforeId: Long? = null,
    ): List<Message>

    @POST("api/conversations/{id}/messages")
    suspend fun send(
        @Path("id") conversationId: Long,
        @Body body: SendMessageBody,
    ): Message
}
