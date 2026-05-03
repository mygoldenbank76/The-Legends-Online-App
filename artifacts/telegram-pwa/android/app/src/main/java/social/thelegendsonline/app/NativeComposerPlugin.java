package social.thelegendsonline.app;

import android.content.Context;
import android.graphics.Color;
import android.os.Build;
import android.os.LocaleList;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.TypedValue;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;
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
    // Last bounds requested by JS, in NATIVE pixels. Cached so we can
    // re-apply them after ensureOverlay() recreates the layout params.
    private int lastX = 0, lastY = 0, lastW = ViewGroup.LayoutParams.MATCH_PARENT,
            lastH = ViewGroup.LayoutParams.WRAP_CONTENT;

    private int dpToPx(float dp) {
        return Math.round(dp * getActivity().getResources().getDisplayMetrics().density);
    }

    /**
     * Anonymous EditText subclass that:
     *   - Forwards every selection change to JS as `selectionChanged`,
     *     so React can show its custom FormattingToolbar (Copier /
     *     Coller / Gras / Italique / Souligner / Barrer / Spoiler /
     *     Lien) instead of Android's system "Traduire / Couper /
     *     Copier / Coller" floating action bar.
     *   - Suppresses both selection AND insertion action modes (the
     *     system menu) by attaching no-op ActionMode.Callbacks. Touches
     *     and long-press still focus the field; only the system menu
     *     is hidden.
     */
    private class BridgedEditText extends EditText {
        BridgedEditText(Context c) { super(c); }

        @Override
        protected void onSelectionChanged(int selStart, int selEnd) {
            super.onSelectionChanged(selStart, selEnd);
            // Android calls onSelectionChanged from the EditText
            // constructor BEFORE our `editText` field is assigned, and
            // also during programmatic setText/setSelection driven from
            // JS. Skip both to avoid emitting bogus events / racing the
            // bridge during plugin construction.
            if (syncingFromJs) return;
            if (editText == null) return;
            JSObject ret = new JSObject();
            ret.put("start", selStart);
            ret.put("end", selEnd);
            notifyListeners("selectionChanged", ret);
        }
    }

    /**
     * Returns false from onCreateActionMode → the system menu never
     * appears. The other callbacks are just stubs (never invoked when
     * onCreate returns false, but Android's ActionMode interface
     * requires all four).
     */
    private static final ActionMode.Callback NO_MENU = new ActionMode.Callback() {
        @Override public boolean onCreateActionMode(ActionMode m, Menu menu) { return false; }
        @Override public boolean onPrepareActionMode(ActionMode m, Menu menu) { return false; }
        @Override public boolean onActionItemClicked(ActionMode m, MenuItem i) { return false; }
        @Override public void onDestroyActionMode(ActionMode m) {}
    };

    private void ensureOverlay() {
        if (editText != null) return;
        Context ctx = getActivity();

        editText = new BridgedEditText(ctx);
        // Suppress the floating "Traduire / Couper / Copier / Coller"
        // action bar — we forward selection events to JS and let the
        // React FormattingToolbar handle copy/paste/format actions.
        editText.setCustomSelectionActionModeCallback(NO_MENU);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            editText.setCustomInsertionActionModeCallback(NO_MENU);
        }

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
        // Transparent background — the HTML composer pill already paints
        // the rounded background underneath; we just want the text +
        // caret to render on top of it.
        editText.setBackgroundColor(Color.TRANSPARENT);
        editText.setTextColor(Color.WHITE);
        editText.setHintTextColor(0xFF888888);
        editText.setHint("Message");
        // Match the HTML <Textarea> exactly: `px-0 py-2.5 text-sm` →
        // 0px horizontal padding, 10px vertical, 14sp text. Without
        // matching the HTML padding the text sits visibly indented from
        // the GIF/+ buttons compared to the web version.
        editText.setPadding(0, dpToPx(10), 0, dpToPx(10));
        editText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        // Drop the EditText's default underline + min height insets so
        // it really hugs the textarea rect.
        editText.setIncludeFontPadding(false);

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
        // Transparent — only the EditText itself paints. Touches outside
        // the EditText pass through to the WebView underneath because the
        // overlay is sized exactly to the EditText bounds (see applyBounds).
        overlay.setBackgroundColor(Color.TRANSPARENT);
        overlay.addView(editText, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
    }

    /**
     * Re-applies the cached bounds to the overlay's LayoutParams. Called
     * from show() after attaching to the root, and from setBounds() when
     * JS reports a layout change.
     */
    private void applyBounds() {
        if (overlay == null) return;
        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) overlay.getLayoutParams();
        if (lp == null) {
            lp = new FrameLayout.LayoutParams(lastW, lastH);
        } else {
            lp.width = lastW;
            lp.height = lastH;
        }
        lp.leftMargin = lastX;
        lp.topMargin = lastY;
        overlay.setLayoutParams(lp);
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
                root.addView(overlay, new FrameLayout.LayoutParams(lastW, lastH));
                applyBounds();
            }
            overlay.setVisibility(View.VISIBLE);
            // No requestFocus / showSoftInput here — the user's tap on the
            // HTML composer pill triggers focus naturally via the WebView,
            // and we don't want the keyboard to pop on every chat open.
            call.resolve();
        });
    }

    @PluginMethod
    public void setBounds(PluginCall call) {
        final double xCss = call.getDouble("x", 0d);
        final double yCss = call.getDouble("y", 0d);
        final double wCss = call.getDouble("width", 0d);
        final double hCss = call.getDouble("height", 0d);
        getActivity().runOnUiThread(() -> {
            lastX = dpToPx((float) xCss);
            lastY = dpToPx((float) yCss);
            lastW = Math.max(1, dpToPx((float) wCss));
            lastH = Math.max(1, dpToPx((float) hCss));
            applyBounds();
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

    /**
     * Push a selection (cursor or highlighted range) from JS into the
     * native EditText. Used after the React FormattingToolbar mutates
     * content (bold / italic / link wrap / paste) so the native caret
     * lands at the same place the user expects, instead of staying at
     * its pre-format position.
     */
    @PluginMethod
    public void setSelection(PluginCall call) {
        final int start = call.getInt("start", 0);
        final int end = call.getInt("end", start);
        getActivity().runOnUiThread(() -> {
            if (editText != null) {
                syncingFromJs = true;
                final int len = editText.getText().length();
                final int s = Math.max(0, Math.min(start, len));
                final int e = Math.max(s, Math.min(end, len));
                editText.setSelection(s, e);
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
