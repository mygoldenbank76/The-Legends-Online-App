import { registerPlugin, Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

/**
 * NativeComposer — JS contract for the native Android EditText overlay
 * that gives us Samsung Keyboard's word-prediction strip, autocorrect,
 * and auto-capitalisation. The Chromium WebView intercepts IME at a
 * level below our outer WebView subclass, so an HTML <textarea> cannot
 * reliably surface those features. This bridge lets the React composer
 * defer text entry to a real native EditText on Android.
 *
 * The Java implementation lives in
 * artifacts/telegram-pwa/android/app/src/main/java/social/thelegendsonline/app/NativeComposerPlugin.java
 *
 * Web: all methods resolve as no-ops so the same JS module loads safely
 * in the browser preview without any platform-specific guards.
 */
export interface NativeComposerPlugin {
  /**
   * Mounts the EditText overlay (full width, anchored to the bottom of
   * the screen in v1) and shows the soft keyboard. If `value` is given,
   * the field is pre-filled with that text and the cursor is placed at
   * the end. Resolves once the overlay is on screen and focused.
   */
  show(options?: { value?: string; placeholder?: string }): Promise<void>;

  /**
   * Hides the overlay and dismisses the soft keyboard. The EditText
   * itself is kept in memory across hide/show cycles so its IME state
   * (composition span, suggestion strip cache) survives.
   */
  hide(): Promise<void>;

  /**
   * Push a value from JS into the EditText. Used to keep the native
   * field in sync when JS-side actions modify the composer (emoji
   * panel insert, paste handler, /clear command, etc.). The TextWatcher
   * is muted while this runs so the value does not bounce back to JS.
   */
  setValue(options: { value: string }): Promise<void>;

  /**
   * Position the EditText overlay over the HTML composer textarea.
   * Coordinates are in CSS pixels (same coordinate space as
   * `getBoundingClientRect()`); the native side converts to physical
   * pixels via display density. Call on every layout change of the
   * underlying textarea (ResizeObserver + window resize + visualViewport
   * resize for the keyboard).
   */
  setBounds(options: { x: number; y: number; width: number; height: number }): Promise<void>;

  /** Read the current EditText value. */
  getValue(): Promise<{ value: string }>;

  /** Re-focus the EditText and re-show the soft keyboard. */
  focus(): Promise<void>;

  /** Drop EditText focus and dismiss the soft keyboard. */
  blur(): Promise<void>;

  /**
   * Fired by the native TextWatcher whenever the user types, pastes,
   * or otherwise mutates the EditText value. Not fired for changes
   * pushed FROM JS via setValue().
   */
  addListener(
    eventName: 'valueChanged',
    listener: (data: { value: string }) => void,
  ): Promise<PluginListenerHandle>;

  /**
   * Fired by the native EditText whenever the selection (cursor or
   * highlighted range) moves — including when the user long-presses
   * to start a selection. JS uses this to drive the custom React
   * FormattingToolbar (Copier / Coller / Gras / etc) instead of the
   * suppressed Android system action bar.
   */
  addListener(
    eventName: 'selectionChanged',
    listener: (data: { start: number; end: number }) => void,
  ): Promise<PluginListenerHandle>;

  /**
   * Push a selection (cursor or range) into the native EditText.
   * React's FormattingToolbar calls this after every format-apply or
   * paste so the native caret follows the post-mutation position
   * instead of staying at the pre-format index.
   */
  setSelection(opts: { start: number; end: number }): Promise<void>;

  /**
   * Show or hide the overlay without tearing down its content or the
   * soft keyboard. JS calls this with `false` when a fullscreen
   * React modal opens (so the always-on-top native EditText doesn't
   * bleed through the modal backdrop) and `true` when it closes.
   */
  setOverlayVisible(opts: { visible: boolean }): Promise<void>;
}

const noop = async () => undefined;

/**
 * Web stub: sync selection back to native EditText. No-op on web.
 */

export const NativeComposer = registerPlugin<NativeComposerPlugin>('NativeComposer', {
  // Web fallback — every method resolves as a no-op so the same module
  // can be imported unconditionally from React code that runs in both
  // the browser preview and the native APK.
  web: () => ({
    show: noop,
    hide: noop,
    setValue: noop,
    setSelection: noop,
    setOverlayVisible: noop,
    setBounds: noop,
    getValue: async () => ({ value: '' }),
    focus: noop,
    blur: noop,
    addListener: async () => ({
      remove: noop,
    }) as unknown as PluginListenerHandle,
  }),
});

/**
 * True only on the Android APK build. JS callers can use this to gate
 * the native overlay path vs the existing HTML <textarea> composer:
 *
 *   if (isNativeComposerAvailable()) {
 *     await NativeComposer.show({ value: content });
 *   } else {
 *     // fall back to the HTML composer
 *   }
 */
export function isNativeComposerAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}
