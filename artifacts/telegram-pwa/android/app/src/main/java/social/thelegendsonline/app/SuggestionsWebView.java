package social.thelegendsonline.app;

import android.content.Context;
import android.text.InputType;
import android.util.AttributeSet;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;

import com.getcapacitor.CapacitorWebView;

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
 *   native level: strip the NO_SUGGESTIONS flag and add AUTO_CORRECT +
 *   CAP_SENTENCES so the IME treats every text field in the WebView like a
 *   regular Android EditText. This is referenced as the standard solution in
 *   the Cordova / Capacitor community for "WebView keyboard has no
 *   suggestions" bugs.
 *
 * Wired in via a resource-overlay of bridge_layout_main.xml that names this
 * class instead of com.getcapacitor.CapacitorWebView.
 */
public class SuggestionsWebView extends CapacitorWebView {

    public SuggestionsWebView(Context context) {
        super(context);
    }

    public SuggestionsWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    public SuggestionsWebView(Context context, AttributeSet attrs, int defStyleAttr) {
        super(context, attrs, defStyleAttr);
    }

    @Override
    public InputConnection onCreateInputConnection(EditorInfo outAttrs) {
        InputConnection ic = super.onCreateInputConnection(outAttrs);
        if (outAttrs != null) {
            // Make sure the field is treated as multi-line text (the message
            // composer is a <textarea>) and ENABLE the prediction strip.
            outAttrs.inputType &= ~InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS;
            outAttrs.inputType |= InputType.TYPE_CLASS_TEXT
                    | InputType.TYPE_TEXT_FLAG_MULTI_LINE
                    | InputType.TYPE_TEXT_FLAG_AUTO_CORRECT
                    | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES;
            // Also clear the "no personalized learning" flag so the keyboard
            // can adapt to the user's vocabulary over time.
            outAttrs.imeOptions &= ~EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING;
        }
        return ic;
    }
}
