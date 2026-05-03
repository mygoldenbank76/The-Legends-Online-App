package social.thelegendsonline.app;

import android.content.Context;
import android.graphics.Color;
import android.os.Build;
import android.os.LocaleList;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.FrameLayout;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;

/**
 * NativeComposer — overlays a real Android EditText on top of the WebView so
 * the user gets the native Samsung / GBoard prediction strip, autocorrect,
 * and auto-capitalisation that a Chromium WebView <textarea> simply cannot
 * surface (Chromium intercepts IME at a layer below the WebView's outer
 * onCreateInputConnection override).
 *
 * Architecture (v1 — minimum viable):
 *   - JS calls show() with optional initial value + placeholder.
 *   - We attach a FrameLayout overlay to android.R.id.content, anchored
 *     to the bottom of the screen, containing a single EditText sized
 *     match_parent x wrap_content.
 *   - The EditText is configured with the EXACT InputType flags
 *     Telegram-Android uses in ChatActivityEnterView lines 5583-5590
 *     (TYPE_CLASS_TEXT | CAP_SENTENCES | AUTO_CORRECT | MULTI_LINE).
 *   - A TextWatcher emits valueChanged events back to JS for sync.
 *   - hide() removes the overlay and dismisses the keyboard.
 *
 * Future work (deferred to subsequent rounds, see chat-area integration):
 *   - setBounds() to position the overlay precisely over the HTML
 *     composer rect (right now it's pinned full-width to the bottom).
 *   - Selection / cursor sync for formatting toolbar parity.
 *   - Image / GIF paste handler (currently text-only).
 *   - Mentions popup positioning.
 *
 * Contract is defined on the JS side in src/lib/native-composer.ts.
 */
@CapacitorPlugin(name = "NativeComposer")
public class NativeComposerPlugin extends Plugin {

    private EditText editText;
    private FrameLayout overlay;
    // Set to true while we are programmatically pushing a value into
    // the EditText (from JS via setValue) so the TextWatcher does not
    // bounce that same value back to JS as a "user typed this" event,
    // which would create an infinite sync loop.
    private boolean syncingFromJs = false;

    private void ensureOverlay() {
        if (editText != null) return;
        Context ctx = getActivity();

        editText = new EditText(ctx);

        // Mirrors DrKLO/Telegram ChatActivityEnterView lines 5583-5590.
        // CRITICAL: this is a real, native EditText (not a WebView
        // subclass), so all IME flags actually take effect — Samsung
        // Keyboard sees a normal text field and shows its prediction
        // strip + autocorrect + autocaps just like in Telegram.
        editText.setInputType(InputType.TYPE_CLASS_TEXT
                | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
                | InputType.TYPE_TEXT_FLAG_AUTO_CORRECT
                | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        editText.setImeOptions(EditorInfo.IME_FLAG_NO_EXTRACT_UI);

        // Hint French + English dictionaries for the IME (API 24+).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try {
                editText.setImeHintLocales(new LocaleList(Locale.FRENCH, Locale.ENGLISH));
            } catch (Throwable ignored) { /* unsupported on some OEM forks */ }
        }

        editText.setMaxLines(4);
        editText.setBackgroundColor(0xFF1a1a2a);
        editText.setTextColor(Color.WHITE);
        editText.setHintTextColor(0xFF888888);
        editText.setHint("Message");
        int padPx = (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 12,
                ctx.getResources().getDisplayMetrics());
        editText.setPadding(padPx, padPx, padPx, padPx);
        editText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);

        editText.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {}
            @Override
            public void afterTextChanged(Editable s) {
                if (syncingFromJs) return;
                JSObject ret = new JSObject();
                ret.put("value", s.toString());
                notifyListeners("valueChanged", ret);
            }
        });

        overlay = new FrameLayout(ctx);
        overlay.setBackgroundColor(0xFF0c1019);
        overlay.addView(editText, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT));
    }

    @PluginMethod
    public void show(PluginCall call) {
        final String initialValue = call.getString("value", "");
        final String placeholder = call.getString("placeholder", "Message");
        getActivity().runOnUiThread(() -> {
            ensureOverlay();
            editText.setHint(placeholder);
            syncingFromJs = true;
            editText.setText(initialValue);
            editText.setSelection(initialValue == null ? 0 : initialValue.length());
            syncingFromJs = false;

            ViewGroup root = getActivity().findViewById(android.R.id.content);
            if (overlay.getParent() == null) {
                FrameLayout.LayoutParams rootLp = new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.WRAP_CONTENT);
                rootLp.gravity = Gravity.BOTTOM;
                root.addView(overlay, rootLp);
            }
            overlay.setVisibility(View.VISIBLE);
            editText.requestFocus();
            InputMethodManager imm = (InputMethodManager) getActivity()
                    .getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm != null) imm.showSoftInput(editText, InputMethodManager.SHOW_IMPLICIT);
            call.resolve();
        });
    }

    @PluginMethod
    public void hide(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (overlay != null) overlay.setVisibility(View.GONE);
            if (editText != null) {
                InputMethodManager imm = (InputMethodManager) getActivity()
                        .getSystemService(Context.INPUT_METHOD_SERVICE);
                if (imm != null) imm.hideSoftInputFromWindow(editText.getWindowToken(), 0);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void setValue(PluginCall call) {
        final String value = call.getString("value", "");
        getActivity().runOnUiThread(() -> {
            if (editText != null) {
                syncingFromJs = true;
                final int cursor = editText.getSelectionStart();
                editText.setText(value);
                final int safe = Math.min(value == null ? 0 : value.length(), cursor < 0 ? 0 : cursor);
                editText.setSelection(safe);
                syncingFromJs = false;
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void getValue(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            JSObject ret = new JSObject();
            ret.put("value", editText != null ? editText.getText().toString() : "");
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void focus(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (editText != null) {
                editText.requestFocus();
                InputMethodManager imm = (InputMethodManager) getActivity()
                        .getSystemService(Context.INPUT_METHOD_SERVICE);
                if (imm != null) imm.showSoftInput(editText, InputMethodManager.SHOW_IMPLICIT);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void blur(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (editText != null) {
                editText.clearFocus();
                InputMethodManager imm = (InputMethodManager) getActivity()
                        .getSystemService(Context.INPUT_METHOD_SERVICE);
                if (imm != null) imm.hideSoftInputFromWindow(editText.getWindowToken(), 0);
            }
            call.resolve();
        });
    }
}
