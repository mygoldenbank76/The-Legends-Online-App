package social.thelegendsonline.native_app.data.socket

import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.serialization.json.Json
import org.json.JSONObject
import social.thelegendsonline.native_app.data.openapi.model.Message
import social.thelegendsonline.native_app.data.repo.TokenStore

/**
 * Socket.io client mirroring `socket-context.tsx` (web). The server
 * (`api-server/src/app.ts:227`) authenticates via
 * `socket.handshake.auth?.token` ONLY — query string and Authorization
 * headers are ignored on the socket transport. We therefore pass the
 * JWT through the `auth` payload using `IO.Options.setAuth(...)`.
 *
 * Surface kept narrow for the MVP: connect once authenticated, expose
 * a hot SharedFlow of `new_message` payloads. Other events (typing,
 * reactions, calls, presence) will be added in dedicated follow-ups —
 * they share the same `socket` instance so we won't have to
 * re-architect anything.
 */
class RealtimeClient(
    private val baseUrl: String,
    private val tokenStore: TokenStore,
) {
    private val json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
        explicitNulls = false
    }

    @Volatile
    private var socket: Socket? = null

    private val _messages = MutableSharedFlow<Message>(extraBufferCapacity = 64)
    val newMessages: SharedFlow<Message> = _messages.asSharedFlow()

    private val _connected = MutableSharedFlow<Boolean>(replay = 1)
    val connected: SharedFlow<Boolean> = _connected.asSharedFlow()

    fun connect() {
        val token = tokenStore.currentToken ?: return
        if (socket?.connected() == true) return

        val opts = IO.Options.builder()
            .setPath("/socket.io/")
            .setTransports(arrayOf("websocket"))
            .setReconnection(true)
            .setReconnectionDelay(1000)
            // Server reads `socket.handshake.auth.token` — must use
            // `setAuth`, NOT query string or Authorization header.
            .setAuth(mapOf("token" to token))
            .build()

        val s = IO.socket(baseUrl, opts)
        s.on(Socket.EVENT_CONNECT) { _connected.tryEmit(true) }
        s.on(Socket.EVENT_DISCONNECT) { _connected.tryEmit(false) }
        s.on("new_message") { args ->
            val raw = args.firstOrNull() as? JSONObject ?: return@on
            runCatching { json.decodeFromString(Message.serializer(), raw.toString()) }
                .getOrNull()
                ?.let { _messages.tryEmit(it) }
        }
        s.connect()
        socket = s
    }

    fun joinConversation(id: Long) {
        socket?.emit("join_conversation", id)
    }

    fun leaveConversation(id: Long) {
        socket?.emit("leave_conversation", id)
    }

    fun disconnect() {
        socket?.let { s ->
            s.off()
            s.disconnect()
        }
        socket = null
    }
}
