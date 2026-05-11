package social.thelegendsonline.native_app.ui.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import social.thelegendsonline.native_app.LegendsApp
import social.thelegendsonline.native_app.R

@Composable
fun LoginScreen(onLoggedIn: () -> Unit, onGoToRegister: () -> Unit) {
    val app = LegendsApp.get()
    val scope = rememberCoroutineScope()
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = "The Legends Online",
            color = MaterialTheme.colorScheme.primary,
            fontSize = 26.sp,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = stringRes(R.string.login_title),
            color = MaterialTheme.colorScheme.onBackground,
            fontSize = 18.sp,
        )
        Spacer(Modifier.height(24.dp))
        OutlinedTextField(
            value = username,
            onValueChange = { username = it.trim() },
            label = { Text(stringRes(R.string.login_username)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text(stringRes(R.string.login_password)) },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(),
        )
        if (error != null) {
            Spacer(Modifier.height(8.dp))
            Text(error!!, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
        }
        Spacer(Modifier.height(20.dp))
        Button(
            onClick = {
                if (loading) return@Button
                if (username.isBlank() || password.isBlank()) return@Button
                loading = true
                error = null
                scope.launch {
                    runCatching { app.authRepo.login(username, password) }
                        .onSuccess {
                            app.onAuthenticated()
                            app.realtime.connect()
                            onLoggedIn()
                        }
                        .onFailure { error = it.message ?: stringRes(R.string.login_failed) }
                    loading = false
                }
            },
            enabled = !loading,
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (loading) CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.height(18.dp))
            else Text(stringRes(R.string.login_submit))
        }
        Spacer(Modifier.height(8.dp))
        TextButton(onClick = onGoToRegister) {
            Text(stringRes(R.string.login_to_register))
        }
    }
}

@Composable
private fun stringRes(id: Int): String = androidx.compose.ui.res.stringResource(id)
