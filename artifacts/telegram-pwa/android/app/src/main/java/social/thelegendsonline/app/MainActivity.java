package social.thelegendsonline.app;

import android.Manifest;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
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

    private static final int REQ_WEBVIEW_PERMS = 4242;
    private PermissionRequest pendingRequest;
    // Tracks the in-flight APK download so we can fire the install
    // Intent automatically the moment DownloadManager broadcasts
    // ACTION_DOWNLOAD_COMPLETE for that exact ID. Without this we'd
    // launch the installer for every download the device finishes
    // (e.g. user-saved photos), which would be jarring.
    private long pendingApkDownloadId = -1L;
    private BroadcastReceiver downloadCompleteReceiver;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

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
                            // Remember this id so the broadcast receiver
                            // can match the right download and trigger
                            // the installer automatically.
                            pendingApkDownloadId = id;
                            Toast.makeText(getApplicationContext(),
                                    "Téléchargement de la mise à jour en cours… L'installation démarrera automatiquement.",
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
                if (id == -1L || id != pendingApkDownloadId) return;
                pendingApkDownloadId = -1L;
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
                        String localUri = uriIdx >= 0 ? c.getString(uriIdx) : null;
                        if (localUri == null) return;
                        Uri parsed = Uri.parse(localUri);
                        File apkFile;
                        if ("file".equals(parsed.getScheme())) {
                            apkFile = new File(parsed.getPath());
                        } else {
                            return;
                        }
                        if (!apkFile.exists()) return;

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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                        this,
                        new String[]{Manifest.permission.POST_NOTIFICATIONS},
                        9001
                );
            }
        }
    }

    @Override
    protected void onDestroy() {
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
