package social.thelegendsonline.native_app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import social.thelegendsonline.native_app.ui.auth.LoginScreen
import social.thelegendsonline.native_app.ui.auth.RegisterScreen
import social.thelegendsonline.native_app.ui.chat.ChatScreen
import social.thelegendsonline.native_app.ui.conversations.ConversationsScreen
import social.thelegendsonline.native_app.ui.theme.LegendsTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            LegendsTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    AppNavigation()
                }
            }
        }
    }
}

@Composable
private fun AppNavigation() {
    val nav = rememberNavController()
    val app = LegendsApp.get()
    val token by app.tokenStore.tokenFlow.collectAsState(initial = null)
    val startDest = if (token.isNullOrBlank()) Routes.Login else Routes.Conversations

    NavHost(navController = nav, startDestination = startDest) {
        composable(Routes.Login) {
            LoginScreen(
                onLoggedIn = {
                    nav.navigate(Routes.Conversations) {
                        popUpTo(Routes.Login) { inclusive = true }
                    }
                },
                onGoToRegister = { nav.navigate(Routes.Register) },
            )
        }
        composable(Routes.Register) {
            RegisterScreen(
                onRegistered = {
                    nav.navigate(Routes.Conversations) {
                        popUpTo(Routes.Login) { inclusive = true }
                    }
                },
                onGoToLogin = { nav.popBackStack() },
            )
        }
        composable(Routes.Conversations) {
            ConversationsScreen(
                onConversationClick = { id, title ->
                    nav.navigate("${Routes.ChatPrefix}/$id?title=${java.net.URLEncoder.encode(title, "UTF-8")}")
                },
                onLoggedOut = {
                    nav.navigate(Routes.Login) {
                        popUpTo(Routes.Conversations) { inclusive = true }
                    }
                },
            )
        }
        composable("${Routes.ChatPrefix}/{convId}?title={title}") { backStack ->
            val convId = backStack.arguments?.getString("convId")?.toLongOrNull() ?: return@composable
            val title = backStack.arguments?.getString("title").orEmpty()
            ChatScreen(
                conversationId = convId,
                title = java.net.URLDecoder.decode(title, "UTF-8"),
                onBack = { nav.popBackStack() },
            )
        }
    }
}

private object Routes {
    const val Login = "login"
    const val Register = "register"
    const val Conversations = "conversations"
    const val ChatPrefix = "chat"
}
