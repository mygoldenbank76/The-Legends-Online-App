import type { CapacitorConfig } from '@capacitor/cli';

// ─────────────────────────────────────────────────────────────────────────────
// The APK is a thin Capacitor WebView shell that loads the live web app from
// our production domain. This is a deliberate choice: every web deploy
// instantly reaches all installed APKs without requiring a Play Store / APK
// update. The trade-off (offline behavior) is mitigated by the service worker
// in `public/sw.js`, which precaches the app shell and falls back to the
// cached HTML when the network is unreachable.
// ─────────────────────────────────────────────────────────────────────────────
const config: CapacitorConfig = {
  appId: 'social.thelegendsonline.app',
  appName: 'The Legends Online',
  webDir: 'dist/public',
  server: {
    url: 'https://thelegendsonline.social',
    cleartext: false,
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    // Enable Chrome DevTools `chrome://inspect` access against the WebView.
    // No security exposure for end users (the bridge requires USB
    // debugging to be enabled on the device first), and it's the only
    // realistic way to triage APK-only bugs reported by users.
    webContentsDebuggingEnabled: true,
    backgroundColor: '#0c1019',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      launchFadeOutDuration: 300,
      backgroundColor: '#0c1019',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#00000000',
      overlaysWebView: true,
    },
    // Keyboard handling — without this, the Android WebView does NOT
    // resize when the soft keyboard opens (because we run in
    // edge-to-edge mode with windowDrawsSystemBarBackgrounds=true,
    // which disables the OS auto-resize). `resize: 'native'` makes
    // Capacitor resize the WebView itself so inputs stay visible
    // and our Visual Viewport JS in App.tsx tracks the new height.
    // `resizeOnFullScreen: true` covers the immersive splash → app
    // transition. `style: 'DARK'` matches our dark Telegram theme.
    Keyboard: {
      resize: 'native',
      resizeOnFullScreen: true,
      style: 'DARK',
    },
  },
};

export default config;
