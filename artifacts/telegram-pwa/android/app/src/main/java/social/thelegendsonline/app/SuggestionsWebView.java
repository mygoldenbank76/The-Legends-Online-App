package social.thelegendsonline.app;

import android.content.Context;
import android.os.Build;
import android.os.LocaleList;
import android.text.InputType;
import android.util.AttributeSet;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;

import com.getcapacitor.CapacitorWebView;

import java.util.Locale;

/**
 * Custom WebView subclass used in place of the default CapacitorWebView so we
 * can force the on-screen keyboard to show suggestions, autocorrect, and
 * automatic sentence capitalization inside our message composer.
 *
 * Why this exists:
 *   The Android WebView, by default, configures every <textarea> / <input>
 *   with InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS. The HTML attributes
 *   (autocorrect="on", spellCheck=true, autoCapitalize="sentences", lang="fr-FR")
 *   that we set on the React side are honored only sporadically by Samsung
 *   Keyboard / GBoard inside a Capacitor WebView — empirically the suggestion
 *   strip stays hidden and "je taime" never gets corrected to "j'aime".
 *
 *   The only reliable fix is to override onCreateInputConnection at the
 *   native level: rewrite outAttrs so the IME treats every text field in
 *   the WebView like a regular Android EditText.
 *
 * Wired in via a resource-overlay of bridge_layout_main.xml that names this
 * class instead of com.getcapacitor.CapacitorWebView.
 */
public class SuggestionsWebView extends CapacitorWebView {

    // CapacitorWebView only exposes the (Context, AttributeSet) constructor —
    // it is always inflated from XML by the bridge layout, so this is the
    // only constructor we need to provide. Adding (Context) or
    // (Context, AttributeSet, int) overloads breaks the build because
    // there is no matching super-constructor to delegate to.
    public SuggestionsWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    @Override
    public InputConnection onCreateInputConnection(EditorInfo outAttrs) {
        InputConnection ic = super.onCreateInputConnection(outAttrs);
        if (outAttrs != null) {
            // Mirror DrKLO/Telegram ChatActivityEnterView, lines 5583-5590:
            //
            //     int flags = EditorInfo.IME_FLAG_NO_EXTRACT_UI;
            //     messageEditText.setImeOptions(flags);
            //     messageEditText.setInputType(messageEditText.getInputType()
            //         | EditorInfo.TYPE_TEXT_FLAG_CAP_SENTENCES
            //         | EditorInfo.TYPE_TEXT_FLAG_MULTI_LINE);
            //
            // Three things we got wrong before, now corrected:
            //
            //  1) Telegram does a BIT-OR on the existing inputType, it
            //     does not assign from scratch. Whatever the platform
            //     seeded into outAttrs (variation, locale hints, etc.)
            //     is preserved.
            //
            //  2) Telegram does NOT set TYPE_TEXT_FLAG_AUTO_CORRECT
            //     explicitly. The autocorrect / suggestion-strip
            //     behaviour is what Android gives you BY DEFAULT on a
            //     plain EditText whenever the NO_SUGGESTIONS flag is
            //     absent. The previous AUTO_COMPLETE we set was the
            //     real source of Samsung's form-fill toolbar.
            //
            //  3) Telegram's imeOptions is JUST IME_FLAG_NO_EXTRACT_UI.
            //     IME_ACTION_NONE / NO_FULLSCREEN are not set — with
            //     MULTI_LINE, the IME already maps Enter to newline.
            //
            // The one thing we have to do that Telegram does not is
            // CLEAR TYPE_TEXT_FLAG_NO_SUGGESTIONS (and the legacy
            // AUTO_COMPLETE bit). Android WebView seeds NO_SUGGESTIONS
            // into outAttrs by default for contenteditable / <textarea>
            // regions, and that is what suppresses the prediction
            // strip in the first place. A plain EditText (what
            // Telegram uses) is never seeded with this flag, so they
            // don't need to clear it.
            outAttrs.inputType = (outAttrs.inputType
                    & ~InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
                    & ~InputType.TYPE_TEXT_FLAG_AUTO_COMPLETE)
                    | InputType.TYPE_CLASS_TEXT
                    | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
                    | InputType.TYPE_TEXT_FLAG_MULTI_LINE;

            outAttrs.imeOptions = EditorInfo.IME_FLAG_NO_EXTRACT_UI;

            // Hint the keyboard's locale so French dictionary +
            // autocorrect kick in on first focus, even when the
            // Samsung keyboard is configured with several languages.
            // Available from API 24+ (Android 7).
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                try {
                    outAttrs.hintLocales = new LocaleList(Locale.FRENCH, Locale.ENGLISH);
                } catch (Throwable ignored) { /* unsupported on some OEM forks */ }
            }
        }
        return ic;
    }
}
