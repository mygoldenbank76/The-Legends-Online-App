package social.thelegendsonline.native_app.data.repo

import social.thelegendsonline.native_app.data.api.AuthApi
import social.thelegendsonline.native_app.data.api.ConversationsApi
import social.thelegendsonline.native_app.data.api.MessagesApi
import social.thelegendsonline.native_app.data.model.FcmRegisterRequest
import social.thelegendsonline.native_app.data.openapi.model.ConversationSummary
import social.thelegendsonline.native_app.data.openapi.model.LoginBody
import social.thelegendsonline.native_app.data.openapi.model.Message
import social.thelegendsonline.native_app.data.openapi.model.RegisterBody
import social.thelegendsonline.native_app.data.openapi.model.SendMessageBody

class AuthRepository(
    private val api: AuthApi,
    private val tokenStore: TokenStore,
) {
    suspend fun login(username: String, password: String) {
        val res = api.login(LoginBody(username = username, password = password))
        tokenStore.save(res.token, res.user.id, res.user.displayName)
    }

    suspend fun register(username: String, password: String, displayName: String) {
        val res = api.register(RegisterBody(username = username, displayName = displayName, password = password))
        tokenStore.save(res.token, res.user.id, res.user.displayName)
    }

    suspend fun logout() {
        tokenStore.clear()
    }

    suspend fun registerFcmToken(token: String) {
        runCatching { api.registerFcm(FcmRegisterRequest(token = token)) }
    }
}

class ConversationsRepository(private val api: ConversationsApi) {
    suspend fun list(): List<ConversationSummary> = api.list()
}

class MessagesRepository(private val api: MessagesApi) {
    suspend fun list(conversationId: Long, beforeId: Long? = null, limit: Long = 50L): List<Message> =
        api.list(conversationId, limit = limit, beforeId = beforeId)

    suspend fun send(conversationId: Long, content: String): Message =
        api.send(conversationId, SendMessageBody(content = content))
}
