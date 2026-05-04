package social.thelegendsonline.app;

import android.Manifest;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.view.WindowManager;
import android.webkit.DownloadListener;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.widget.Toast;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {

    {
        // Register custom Capacitor plugins BEFORE super.onCreate() so
        // the bridge picks them up. AuthBridgePlugin mirrors the JS
        // auth token into SharedPreferences so the inline-reply
        // BroadcastReceiver can POST to /api without booting the WebView.
        registerPlugin(AuthBridgePlugin.class);
        // NativeComposer: overlays a real native EditText on top of the
        // WebView so the user gets Samsung Keyboard's word-prediction
        // strip, autocorrect, and auto-capitalisation that a Chromium
        // WebView <textarea> cannot reliably surface (Chromium handles
        // IME at a layer below our SuggestionsWebView override). The
        // plugin is registered here but not yet wired into the React
        // composer — that integration happens in a follow-up so we can
        // first verify the plugin builds and loads on device.
        registerPlugin(NativeComposerPlugin.class);
    }

    private static final int REQ_WEBVIEW_PERMS = 4242;
    // ── Persisted state keys ────────────────────────────────────────────
    // Without persistence, an Android process kill during the APK
    // download (low memory, swipe-from-recents, etc.) would lose the
    // pending download id in memory and we'd never trigger the system
    // installer when DownloadManager finally finishes — leaving the
    // user to hunt for the APK in their Downloads folder.
    private static final String PREFS_NAME = "legends_apk_state";
    private static final String KEY_PENDING_APK_ID = "pending_apk_download_id";
    // We only auto-prompt the user for "install unknown apps" ONCE (on
    // the first launch where they don't have it granted yet). Asking
    // again on every cold start was perceived as malware-like behavior.
    // The grant naturally re-prompts itself when the user actually
    // taps "Update" in the app — that's the right moment.
    private static final String KEY_ASKED_UNKNOWN_SOURCES = "asked_unknown_sources";

    private PermissionRequest pendingRequest;
    private BroadcastReceiver downloadCompleteReceiver;

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
    }

    private long getPendingApkDownloadId() {
        return prefs().getLong(KEY_PENDING_APK_ID, -1L);
    }

    private void setPendingApkDownloadId(long id) {
        prefs().edit().putLong(KEY_PENDING_APK_ID, id).apply();
    }

    private void clearPendingApkDownloadId() {
        prefs().edit().remove(KEY_PENDING_APK_ID).apply();
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // ── Notification channel ────────────────────────────────────────
        // Created up-front (idempotent) so the very first push the user
        // ever receives lands on a properly-configured HIGH-importance
        // channel with sound + vibration + lock-screen visibility.
        FcmMessagingService.ensureChannel(this);

        // Forward any deep-link extras the launcher Intent carried into
        // the WebView — happens when the user taps a notification while
        // the app's process is dead.
        handleNotificationIntent(getIntent());

        // ── Edge-to-edge (status bar + nav bar transparentes) ───────────
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            getWindow().setStatusBarColor(0x00000000);
            getWindow().setNavigationBarColor(0x00000000);
        }

        // ── WebView permission bridge ───────────────────────────────────
        // Quand le code web (getUserMedia, navigator.mediaDevices, …)
        // demande l'accès au micro ou à la caméra, Android ne grant rien
        // automatiquement : il faut intercepter onPermissionRequest, vérifier
        // / demander la permission Android runtime correspondante, puis
        // appeler request.grant(). Sans ce code, les appels et messages
        // vocaux échouent silencieusement avec NotAllowedError.
        bridge.getWebView().setWebChromeClient(new com.getcapacitor.BridgeWebChromeClient(bridge) {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    String[] resources = request.getResources();
                    List<String> needed = new ArrayList<>();
                    for (String res : resources) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) {
                            if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO)
                                    != PackageManager.PERMISSION_GRANTED) {
                                needed.add(Manifest.permission.RECORD_AUDIO);
                            }
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                                    && ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.BLUETOOTH_CONNECT)
                                    != PackageManager.PERMISSION_GRANTED) {
                                needed.add(Manifest.permission.BLUETOOTH_CONNECT);
                            }
                        } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)) {
                            if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA)
                                    != PackageManager.PERMISSION_GRANTED) {
                                needed.add(Manifest.permission.CAMERA);
                            }
                        }
                    }

                    if (needed.isEmpty()) {
                        request.grant(resources);
                        return;
                    }

                    pendingRequest = request;
                    ActivityCompat.requestPermissions(
                            MainActivity.this,
                            needed.toArray(new String[0]),
                            REQ_WEBVIEW_PERMS
                    );
                });
            }
        });

        // ── Auto-install bridge (one-tap APK update) ────────────────────
        //
        // Goal: when the user taps the in-app "Update" button, the new
        // APK should download AND install with a single, system-native
        // confirmation, instead of forcing them to (a) tap a download
        // notification, (b) hunt for "Allow installs from this source"
        // in Settings the first time around, and (c) tap install. The
        // last two are what was making the update flow feel broken.
        //
        // The flow is:
        //   1) WebView download starts → we check
        //      packageManager.canRequestPackageInstalls(). If false on
        //      Android 8+, we open the per-app "unknown sources" toggle
        //      directly so the user grants once and never sees that
        //      prompt again.
        //   2) DownloadManager fetches the APK to public Downloads/
        //      with a system progress notification (so the user always
        //      sees that an update is in flight, even outside the app).
        //   3) ACTION_DOWNLOAD_COMPLETE for OUR download id fires →
        //      we resolve the local file:// → wrap it in a content://
        //      URI via FileProvider → fire ACTION_VIEW with
        //      FLAG_GRANT_READ_URI_PERMISSION so the system installer
        //      pops up immediately, no notification tap required.
        bridge.getWebView().setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent,
                                        String contentDisposition, String mimetype,
                                        long contentLength) {
                final String resolvedMime = (mimetype != null && !mimetype.isEmpty())
                        ? mimetype
                        : "application/vnd.android.package-archive";
                final boolean isApk =
                        "application/vnd.android.package-archive".equalsIgnoreCase(resolvedMime)
                        || (url != null && url.toLowerCase().endsWith(".apk"));

                // Step 1 — for APK downloads only, gate on the "install
                // unknown apps" runtime permission (Android 8+). If the
                // user has not yet granted it for OUR app, sending them
                // straight to the right Settings screen is by far the
                // smoothest UX; the system remembers the grant forever
                // afterwards.
                if (isApk && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    if (!getPackageManager().canRequestPackageInstalls()) {
                        Toast.makeText(getApplicationContext(),
                                "Autorise l'installation depuis cette application puis relance la mise à jour.",
                                Toast.LENGTH_LONG).show();
                        try {
                            Intent grant = new Intent(
                                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                    Uri.parse("package:" + getPackageName()));
                            grant.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            startActivity(grant);
                        } catch (Exception ignored) { /* fall through */ }
                        return;
                    }
                }

                try {
                    String filename = URLUtil.guessFileName(url, contentDisposition, resolvedMime);
                    DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                    req.setMimeType(resolvedMime);
                    if (userAgent != null) req.addRequestHeader("User-Agent", userAgent);
                    req.setTitle(filename);
                    req.setDescription("Téléchargement de la mise à jour…");
                    req.setNotificationVisibility(
                            DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    req.setDestinationInExternalPublicDir(
                            Environment.DIRECTORY_DOWNLOADS, filename);
                    DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    if (dm != null) {
                        long id = dm.enqueue(req);
                        if (isApk) {
                            // Persist the id so the broadcast receiver
                            // can match the right download and trigger
                            // the installer automatically — even if the
                            // process is killed mid-download.
                            setPendingApkDownloadId(id);
                            Toast.makeText(getApplicationContext(),
                                    "Téléchargement de la mise à jour en cours, veuillez ne pas fermer cette page...",
                                    Toast.LENGTH_LONG).show();
                        } else {
                            Toast.makeText(getApplicationContext(),
                                    "Téléchargement en cours…",
                                    Toast.LENGTH_SHORT).show();
                        }
                    }
                } catch (Exception e) {
                    // Last-resort fallback: hand the URL to the system
                    // browser via an ACTION_VIEW intent so the user still
                    // gets a working download path even if DownloadManager
                    // is unavailable on this device profile.
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                    } catch (Exception ignored) { /* nothing else we can do */ }
                }
            }
        });

        // Step 3 — listen for download completion. Runs while the
        // activity is alive (registered in onCreate, unregistered in
        // onDestroy). When DownloadManager broadcasts that OUR APK is
        // done, we resolve its local URI through FileProvider and
        // launch the system PackageInstaller. The user only ever
        // sees: "Update available" → tap → system install dialog →
        // tap install. No download-notification tap in between.
        downloadCompleteReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
                long pendingId = getPendingApkDownloadId();
                if (id == -1L || id != pendingId) return;
                clearPendingApkDownloadId();
                try {
                    DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    if (dm == null) return;
                    DownloadManager.Query q = new DownloadManager.Query().setFilterById(id);
                    Cursor c = dm.query(q);
                    if (c == null) return;
                    try {
                        if (!c.moveToFirst()) return;
                        int statusIdx = c.getColumnIndex(DownloadManager.COLUMN_STATUS);
                        int uriIdx = c.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI);
                        int status = statusIdx >= 0 ? c.getInt(statusIdx) : -1;
                        if (status != DownloadManager.STATUS_SUCCESSFUL) {
                            Toast.makeText(getApplicationContext(),
                                    "Échec du téléchargement de la mise à jour.",
                                    Toast.LENGTH_LONG).show();
                            return;
                        }

                        // Resolve the local file the OEM/Android-version-portable
                        // way: prefer DownloadManager.getUriForDownloadedFile(id),
                        // which is documented to return either a file:// or a
                        // content:// URI depending on the device. Fall back to
                        // COLUMN_LOCAL_URI for older devices where the helper
                        // returns null. Either way we end up with a File pointing
                        // at the APK on disk so we can wrap it in our own
                        // FileProvider URI for the installer Intent (the system
                        // PackageInstaller refuses raw file:// URIs on Android 7+).
                        File apkFile = null;
                        Uri dmUri = dm.getUriForDownloadedFile(id);
                        if (dmUri != null && "file".equals(dmUri.getScheme())) {
                            apkFile = new File(dmUri.getPath());
                        }
                        if (apkFile == null || !apkFile.exists()) {
                            String localUri = uriIdx >= 0 ? c.getString(uriIdx) : null;
                            if (localUri != null) {
                                Uri parsed = Uri.parse(localUri);
                                if ("file".equals(parsed.getScheme())) {
                                    apkFile = new File(parsed.getPath());
                                }
                            }
                        }
                        if (apkFile == null || !apkFile.exists()) {
                            // Last-resort fallback: hand the DownloadManager URI
                            // straight to the installer. Works on devices that
                            // already return a content:// URI from
                            // getUriForDownloadedFile().
                            if (dmUri != null) {
                                Intent fallback = new Intent(Intent.ACTION_VIEW);
                                fallback.setDataAndType(dmUri,
                                        "application/vnd.android.package-archive");
                                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                                        | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                                startActivity(fallback);
                            }
                            return;
                        }

                        Uri contentUri = FileProvider.getUriForFile(
                                MainActivity.this,
                                getPackageName() + ".fileprovider",
                                apkFile);

                        Intent install = new Intent(Intent.ACTION_VIEW);
                        install.setDataAndType(contentUri,
                                "application/vnd.android.package-archive");
                        install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                                | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        startActivity(install);
                    } finally {
                        c.close();
                    }
                } catch (Exception e) {
                    // Swallow — the download notification is still
                    // there as a manual fallback, so nothing is lost.
                }
            }
        };
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Android 13+ requires explicit RECEIVER_NOT_EXPORTED for
            // any dynamically-registered receiver listening to
            // implicit broadcasts. DownloadManager.ACTION_DOWNLOAD_COMPLETE
            // is system-broadcast and we only care about our own
            // downloads, so NOT_EXPORTED is exactly right.
            registerReceiver(downloadCompleteReceiver, filter,
                    Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(downloadCompleteReceiver, filter);
        }

        // ── Demande POST_NOTIFICATIONS au démarrage (Android 13+) ───────
        // Sans cette permission, les notifications push silencieuses ne
        // s'affichent pas, même si le service worker s'est inscrit.
        // On retarde de 300 ms pour laisser le splash screen s'afficher
        // avant la pop-up système (sinon flash visuel bizarre).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            bridge.getWebView().postDelayed(() -> {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
                    ActivityCompat.requestPermissions(
                            this,
                            new String[]{Manifest.permission.POST_NOTIFICATIONS},
                            9001
                    );
                }
            }, 300L);
        }

        // ── Demande "install unknown apps" UNE SEULE FOIS au tout premier
        // démarrage de l'app après installation. Si l'utilisateur refuse,
        // on ne le harcèle PAS à chaque cold start (perçu comme malware) :
        // la prochaine demande arrivera naturellement au moment où il
        // tape "Mettre à jour" — ce qui est le bon contexte UX.
        //
        // Le check s'exécute après un court délai pour ne pas masquer
        // le splash screen et pour laisser le WebView prendre le focus
        // d'abord — sinon le pop-up système peut s'ouvrir avant que
        // l'utilisateur ait vu l'app.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            SharedPreferences sp = prefs();
            boolean alreadyAsked = sp.getBoolean(KEY_ASKED_UNKNOWN_SOURCES, false);
            if (!alreadyAsked) {
                bridge.getWebView().postDelayed(() -> {
                    try {
                        if (!getPackageManager().canRequestPackageInstalls()) {
                            sp.edit().putBoolean(KEY_ASKED_UNKNOWN_SOURCES, true).apply();
                            Toast.makeText(getApplicationContext(),
                                    "Active \"Autoriser cette source\" pour recevoir les mises à jour automatiques de l'application.",
                                    Toast.LENGTH_LONG).show();
                            Intent grant = new Intent(
                                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                    Uri.parse("package:" + getPackageName()));
                            grant.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            startActivity(grant);
                        } else {
                            // Already granted — record so we never re-ask.
                            sp.edit().putBoolean(KEY_ASKED_UNKNOWN_SOURCES, true).apply();
                        }
                    } catch (Exception ignored) { /* skip silently — we'll re-ask at update time as a safety net */ }
                }, 2500L);
            }
        }
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // Activity launch mode is singleTask so a notification tap
        // while the app is already in memory comes through here, not
        // through onCreate. We forward the same deep-link payload to JS.
        handleNotificationIntent(intent);
    }

    /**
     * Translates the FCM notification's intent extras into a JS-side
     * navigation by injecting a `?conv=…&msg=…` URL into the WebView.
     * This is the single bridge between native notification taps and
     * the React router (home.tsx parses these URL params on mount AND
     * we re-fire a CustomEvent for already-mounted instances).
     */
    private void handleNotificationIntent(Intent intent) {
        if (intent == null) return;
        Bundle extras = intent.getExtras();
        if (extras == null) return;
        if (!extras.containsKey(FcmMessagingService.EXTRA_CONVERSATION_ID)) return;

        int conversationId = extras.getInt(FcmMessagingService.EXTRA_CONVERSATION_ID, -1);
        if (conversationId <= 0) return;
        boolean isGroup = extras.getBoolean(FcmMessagingService.EXTRA_IS_GROUP, false);
        String messageId = extras.getString(FcmMessagingService.EXTRA_MESSAGE_ID, null);
        String type = extras.getString(FcmMessagingService.EXTRA_TYPE, null);

        // Clear the corresponding tray notification — the user has
        // engaged with it; leaving the bubble around is just noise.
        try {
            androidx.core.app.NotificationManagerCompat.from(this).cancel(conversationId);
        } catch (Exception ignored) {}
        FcmMessagingService.clearThread(getApplicationContext(), conversationId);

        StringBuilder script = new StringBuilder();
        script.append("(function(){try{")
              .append("var p=new URLSearchParams();")
              .append("p.set('conv','").append(conversationId).append("');")
              .append("p.set('type','").append(isGroup ? "group" : "direct").append("');");
        if (messageId != null && !messageId.isEmpty()) {
            // messageId is a numeric string from the server; basic
            // sanitisation so a malformed payload can't inject JS.
            String safeMsgId = messageId.replaceAll("[^0-9]", "");
            if (!safeMsgId.isEmpty()) {
                script.append("p.set('msg','").append(safeMsgId).append("');");
            }
        }
        if ("incoming_call".equals(type)) {
            script.append("p.set('call','1');");
        }
        script.append("var ev=new CustomEvent('native:open-conversation',{detail:{")
              .append("conversationId:").append(conversationId).append(",")
              .append("isGroup:").append(isGroup).append(",")
              .append("messageId:").append(messageId == null ? "null" : ("'" + messageId.replaceAll("[^0-9]", "") + "'")).append(",")
              .append("call:").append("incoming_call".equals(type) ? "true" : "false")
              .append("}});")
              .append("window.dispatchEvent(ev);")
              .append("if(window.location && window.location.search.indexOf('conv=')===-1){")
              .append("var base=(window.__BASE_URL__||'/').replace(/\\/$/,'');")
              .append("window.history.replaceState({},'',base+'/?'+p.toString());")
              .append("}")
              .append("}catch(e){console.error('native deep-link failed',e);}})();");

        // Defer the JS injection slightly so the WebView is alive even
        // on a cold start — Capacitor mounts the bridge in onCreate but
        // the JS runtime needs a tick before window is usable.
        bridge.getWebView().postDelayed(() -> {
            try {
                bridge.getWebView().evaluateJavascript(script.toString(), null);
            } catch (Exception ignored) {}
        }, 250L);
    }

    @Override
    public void onDestroy() {
        // Always unregister the dynamic receiver to avoid the
        // "Activity has leaked IntentReceiver" warning in logcat and
        // the small amount of memory the system would keep around.
        if (downloadCompleteReceiver != null) {
            try { unregisterReceiver(downloadCompleteReceiver); }
            catch (IllegalArgumentException ignored) { /* not registered */ }
            downloadCompleteReceiver = null;
        }
        super.onDestroy();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == REQ_WEBVIEW_PERMS && pendingRequest != null) {
            boolean allGranted = grantResults.length > 0;
            for (int r : grantResults) {
                if (r != PackageManager.PERMISSION_GRANTED) {
                    allGranted = false;
                    break;
                }
            }
            if (allGranted) {
                pendingRequest.grant(pendingRequest.getResources());
            } else {
                pendingRequest.deny();
            }
            pendingRequest = null;
        }
    }
}
