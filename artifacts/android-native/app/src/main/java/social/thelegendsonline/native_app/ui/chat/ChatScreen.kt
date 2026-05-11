package social.thelegendsonline.native_app.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import social.thelegendsonline.native_app.LegendsApp
import social.thelegendsonline.native_app.R
import social.thelegendsonline.native_app.data.openapi.model.Message

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(conversationId: Long, title: String, onBack: () -> Unit) {
    val app = LegendsApp.get()
    val scope = rememberCoroutineScope()
    val myId = app.tokenStore.currentUserId

    val messages = remember { mutableStateListOf<Message>() }
    var loading by remember { mutableStateOf(true) }
    var input by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()

    LaunchedEffect(conversationId) {
        loading = true
        runCatching { app.messagesRepo.list(conversationId) }
            .onSuccess { fetched ->
                messages.clear()
                // Server returns newest-first; render oldest-first so we
                // can simply append new sockets at the end and snap to
                // bottom. Mirror chat-area.tsx ordering convention.
                messages.addAll(fetched.sortedBy { it.id })
                loading = false
            }
            .onFailure { loading = false }
    }

    // Subscribe to live socket events for this conversation.
    DisposableEffect(conversationId) {
        app.realtime.connect()
        app.realtime.joinConversation(conversationId)
        val job = scope.launch {
            app.realtime.newMessages.collect { msg ->
                if (msg.conversationId != conversationId) return@collect
                if (messages.any { it.id == msg.id }) return@collect
                messages.add(msg)
            }
        }
        onDispose {
            job.cancel()
            app.realtime.leaveConversation(conversationId)
        }
    }

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(messages.size - 1)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title.ifBlank { "Conversation" }, fontWeight = FontWeight.SemiBold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.chat_back))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    titleContentColor = MaterialTheme.colorScheme.onSurface,
                ),
            )
        },
        bottomBar = {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surface)
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedTextField(
                    value = input,
                    onValueChange = { input = it },
                    placeholder = { Text(stringResource(R.string.chat_send_placeholder)) },
                    modifier = Modifier.weight(1f),
                    maxLines = 4,
                )
                Spacer(Modifier.width(6.dp))
                IconButton(
                    enabled = !sending && input.isNotBlank(),
                    onClick = {
                        val txt = input.trim()
                        if (txt.isEmpty()) return@IconButton
                        sending = true
                        scope.launch {
                            runCatching { app.messagesRepo.send(conversationId, txt) }
                                .onSuccess { sent ->
                                    if (messages.none { it.id == sent.id }) messages.add(sent)
                                    input = ""
                                }
                            sending = false
                        }
                    },
                ) {
                    Icon(Icons.AutoMirrored.Filled.Send, contentDescription = stringResource(R.string.chat_send), tint = MaterialTheme.colorScheme.primary)
                }
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            if (loading) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize().padding(horizontal = 8.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    items(messages, key = { it.id }) { m -> MessageBubble(m, isMine = m.senderId == myId) }
                }
            }
        }
    }
}

@Composable
private fun MessageBubble(m: Message, isMine: Boolean) {
    val align = if (isMine) Alignment.End else Alignment.Start
    val bg = if (isMine) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant
    val fg = if (isMine) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface
    Column(modifier = Modifier.fillMaxWidth(), horizontalAlignment = align) {
        if (!isMine && m.sender != null) {
            Text(m.sender!!.displayName, color = MaterialTheme.colorScheme.primary, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
        }
        Box(
            modifier = Modifier
                .widthIn(max = 320.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(bg)
                .padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            Text(m.content.orEmpty(), color = fg, fontSize = 15.sp)
        }
    }
}
