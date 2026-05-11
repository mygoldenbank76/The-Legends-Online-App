package social.thelegendsonline.native_app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.sp

// Telegram-style dark palette — mirrors the web app tokens.
private val LegendsBg = Color(0xFF0C1019)
private val LegendsSurface = Color(0xFF161C2A)
private val LegendsSurfaceAlt = Color(0xFF1F2638)
private val LegendsPrimary = Color(0xFF5B8CFF)
private val LegendsOnPrimary = Color(0xFFFFFFFF)
private val LegendsText = Color(0xFFE7EAF3)
private val LegendsTextMuted = Color(0xFF8A93A8)

private val LegendsDarkColors = darkColorScheme(
    background = LegendsBg,
    surface = LegendsSurface,
    surfaceVariant = LegendsSurfaceAlt,
    primary = LegendsPrimary,
    onPrimary = LegendsOnPrimary,
    onBackground = LegendsText,
    onSurface = LegendsText,
    onSurfaceVariant = LegendsTextMuted,
    secondary = LegendsPrimary,
    onSecondary = LegendsOnPrimary,
    error = Color(0xFFE57373),
)

private val LegendsTypography = Typography(
    bodyLarge = TextStyle(fontSize = 16.sp, color = LegendsText),
    bodyMedium = TextStyle(fontSize = 14.sp, color = LegendsText),
    titleMedium = TextStyle(fontSize = 17.sp, color = LegendsText),
    labelSmall = TextStyle(fontSize = 11.sp, color = LegendsTextMuted),
)

@Composable
fun LegendsTheme(content: @Composable () -> Unit) {
    @Suppress("UNUSED_VARIABLE")
    val dark = isSystemInDarkTheme() // currently always dark — kept for future light support
    MaterialTheme(
        colorScheme = LegendsDarkColors,
        typography = LegendsTypography,
        content = content,
    )
}
