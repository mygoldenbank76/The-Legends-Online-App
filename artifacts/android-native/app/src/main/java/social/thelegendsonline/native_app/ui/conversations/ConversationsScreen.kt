package social.thelegendsonline.native_app.ui.conversations

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
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
import social.thelegendsonline.native_app.data.openapi.model.ConversationSummary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConversationsScreen(
    onConversationClick: (Long, String) -> Unit,
    onLoggedOut: () -> Unit,
) {
    val app = LegendsApp.get()
    val scope = rememberCoroutineScope()
    var items by remember { mutableStateOf<List<ConversationSummary>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        // Make sure socket is up — login already calls this but a cold
        // restart with a saved token lands here directly.
        app.realtime.connect()
        runCatching { app.conversationsRepo.list() }
            .onSuccess { items = it; loading = false }
            .onFailure { error = it.message; loading = false }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.conversations_title)) },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    titleContentColor = MaterialTheme.colorScheme.onSurface,
                ),
                actions = {
                    IconButton(onClick = {
                        scope.launch {
                            app.realtime.disconnect()
                            app.authRepo.logout()
                            onLoggedOut()
                        }
                    }) {
                        Icon(Icons.Default.Logout, contentDescription = stringResource(R.string.logout))
                    }
                },
            )
        },
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            when {
                loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
                error != null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(error!!, color = MaterialTheme.colorScheme.error)
                }
                items.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(stringResource(R.string.conversations_empty), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                else -> LazyColumn(modifier = Modifier.fillMaxSize()) {
                    items(items, key = { it.id }) { c ->
                        ConversationRow(c, onClick = { onConversationClick(c.id, displayTitle(c)) })
                        HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
                    }
                }
            }
        }
    }
}

private fun displayTitle(c: ConversationSummary): String {
    return c.name ?: c.otherUser?.displayName ?: "Conversation #${c.id}"
}

@Composable
private fun ConversationRow(c: ConversationSummary, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(48.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.surfaceVariant),
            contentAlignment = Alignment.Center,
        ) {
            val initial = displayTitle(c).firstOrNull()?.uppercaseChar()?.toString() ?: "?"
            Text(initial, color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(displayTitle(c), color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            val preview = c.lastMessage?.content?.take(80) ?: ""
            if (preview.isNotEmpty()) {
                Text(preview, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp, maxLines = 1)
            }
        }
        if (c.unreadCount > 0) {
            Spacer(Modifier.width(8.dp))
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(50))
                    .background(MaterialTheme.colorScheme.primary)
                    .padding(horizontal = 8.dp, vertical = 2.dp),
            ) {
                Text(c.unreadCount.toString(), color = MaterialTheme.colorScheme.onPrimary, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}
