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
            // Build the inputType from scratch (ASSIGNMENT, not bit-mask
            // OR) so we are not at the mercy of whatever default the
            // platform WebView seeded into outAttrs.
            //
            // These flags are taken VERBATIM from Telegram-Android's
            // ChatActivityEnterView.createMessageEditText():
            //
            //   TYPE_CLASS_TEXT
            //     | TYPE_TEXT_FLAG_CAP_SENTENCES
            //     | TYPE_TEXT_FLAG_AUTO_CORRECT
            //     | TYPE_TEXT_FLAG_MULTI_LINE
            //
            // The two corrections vs the previous version of this class:
            //
            //  * REMOVE TYPE_TEXT_FLAG_AUTO_COMPLETE.
            //    Samsung Keyboard treats AUTO_COMPLETE as "this field
            //    wants saved usernames / addresses / passwords", which
            //    causes it to hide the dictionary prediction strip and
            //    show its form-fill toolbar (clipboard / translate /
            //    settings icons) instead. Removing this flag is what
            //    finally surfaces the "texte / textes / tente" strip on
            //    Samsung Keyboard, matching native Telegram.
            //
            //  * ADD TYPE_TEXT_FLAG_MULTI_LINE.
            //    Telegram itself sets it. Without it, GBoard shows a
            //    "Done" button instead of letting the user insert a
            //    newline, and on physical / Bluetooth keyboards Enter
            //    submits a fake action instead of inserting a line
            //    break. The empirical "Samsung hides predictions on
            //    multi-line" claim from the previous comment turned
            //    out to be wrong — the toolbar was caused by
            //    AUTO_COMPLETE, not by MULTI_LINE.
            outAttrs.inputType = InputType.TYPE_CLASS_TEXT
                    | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
                    | InputType.TYPE_TEXT_FLAG_AUTO_CORRECT
                    | InputType.TYPE_TEXT_FLAG_MULTI_LINE;

            // Tell the IME explicitly that there is no special
            // primary action — this is what Telegram does too. With
            // MULTI_LINE set, Enter must insert a newline, so an
            // IME_ACTION_SEND would be misleading.
            outAttrs.imeOptions = EditorInfo.IME_ACTION_NONE
                    | EditorInfo.IME_FLAG_NO_FULLSCREEN
                    | EditorInfo.IME_FLAG_NO_EXTRACT_UI;

            // Enable personalized learning so the keyboard can adapt to
            // the user's vocabulary over time (clearing the negative
            // flag the WebView default sometimes sets).
            outAttrs.imeOptions &= ~EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING;

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
