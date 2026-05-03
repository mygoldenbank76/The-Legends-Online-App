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
            // Strip the WebView default NO_SUGGESTIONS flag and add the
            // standard text-class flags Android keyboards check before
            // showing the prediction strip + sentence capitalization.
            //
            // CRITICAL: we do NOT set TYPE_TEXT_FLAG_MULTI_LINE here.
            // Samsung Keyboard (the default on every Galaxy device,
            // representing the bulk of our French userbase) HIDES the
            // prediction strip entirely on any field flagged multi-line
            // — it treats the strip as a single-line affordance only.
            // The textarea still accepts newlines via the standard
            // WebView <textarea> path; the IME flag only changes UI
            // affordances, not the actual newline behavior of the
            // underlying contenteditable region. Removing this flag is
            // what finally surfaces both autocorrect suggestions AND
            // first-letter capitalization on Samsung's keyboard, which
            // matches the way Telegram's native EditText is configured
            // (see drklo/telegram ChatActivityEnterView — it never sets
            // MULTI_LINE on its message composer EditText for the same
            // reason).
            outAttrs.inputType &= ~InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS;
            outAttrs.inputType &= ~InputType.TYPE_TEXT_FLAG_MULTI_LINE;
            outAttrs.inputType |= InputType.TYPE_CLASS_TEXT
                    | InputType.TYPE_TEXT_FLAG_AUTO_CORRECT
                    | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES;
            // Also clear the "no personalized learning" flag so the keyboard
            // can adapt to the user's vocabulary over time.
            outAttrs.imeOptions &= ~EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING;
        }
        return ic;
    }
}
