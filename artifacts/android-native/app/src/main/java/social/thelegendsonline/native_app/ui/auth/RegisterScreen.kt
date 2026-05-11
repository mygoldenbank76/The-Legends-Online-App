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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import social.thelegendsonline.native_app.LegendsApp
import social.thelegendsonline.native_app.R

@Composable
fun RegisterScreen(onRegistered: () -> Unit, onGoToLogin: () -> Unit) {
    val app = LegendsApp.get()
    val scope = rememberCoroutineScope()
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var displayName by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            stringResource(R.string.register_title),
            color = MaterialTheme.colorScheme.primary,
            fontSize = 22.sp,
        )
        Spacer(Modifier.height(20.dp))
        OutlinedTextField(
            value = displayName,
            onValueChange = { displayName = it },
            label = { Text(stringResource(R.string.register_display_name)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = username,
            onValueChange = { username = it.trim() },
            label = { Text(stringResource(R.string.login_username)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text(stringResource(R.string.login_password)) },
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
                if (username.isBlank() || password.isBlank() || displayName.isBlank()) return@Button
                loading = true
                error = null
                scope.launch {
                    runCatching { app.authRepo.register(username, password, displayName) }
                        .onSuccess {
                            app.onAuthenticated()
                            app.realtime.connect()
                            onRegistered()
                        }
                        .onFailure { error = it.message ?: "" }
                    loading = false
                }
            },
            enabled = !loading,
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (loading) CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.height(18.dp))
            else Text(stringResource(R.string.register_submit))
        }
        Spacer(Modifier.height(8.dp))
        TextButton(onClick = onGoToLogin) { Text(stringResource(R.string.register_to_login)) }
    }
}
