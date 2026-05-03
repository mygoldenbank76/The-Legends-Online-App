package social.thelegendsonline.app;

import android.Manifest;
import android.app.DownloadManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.WindowManager;
import android.webkit.DownloadListener;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.widget.Toast;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {

    private static final int REQ_WEBVIEW_PERMS = 4242;
    private PermissionRequest pendingRequest;

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
                        // Toutes les permissions Android sont déjà accordées :
                        // on grant immédiatement la requête WebView.
                        request.grant(resources);
                        return;
                    }

                    // Sinon, on stocke la requête, on demande à l'utilisateur,
                    // puis on grant/deny dans onRequestPermissionsResult.
                    pendingRequest = request;
                    ActivityCompat.requestPermissions(
                            MainActivity.this,
                            needed.toArray(new String[0]),
                            REQ_WEBVIEW_PERMS
                    );
                });
            }
        });

        // ── DownloadListener : déclenche le DownloadManager Android pour
        //    le bouton "Mise à jour disponible". Sans ce listener, une
        //    navigation vers /api/download/apk dans la WebView ne fait
        //    rien (la WebView ne sait pas rendre un APK et n'a pas de
        //    handler par défaut pour les Content-Disposition: attachment),
        //    donc le tap sur la carte de mise à jour paraissait mort.
        //    Ici on délègue à DownloadManager qui télécharge le fichier
        //    en arrière-plan, affiche une notif système, et — au tap sur
        //    cette notif — déclenche l'installateur de paquet Android.
        bridge.getWebView().setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent,
                                        String contentDisposition, String mimetype,
                                        long contentLength) {
                try {
                    String resolvedMime = (mimetype != null && !mimetype.isEmpty())
                            ? mimetype
                            : "application/vnd.android.package-archive";
                    String filename = URLUtil.guessFileName(url, contentDisposition, resolvedMime);
                    DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                    req.setMimeType(resolvedMime);
                    if (userAgent != null) req.addRequestHeader("User-Agent", userAgent);
                    req.setTitle(filename);
                    req.setDescription("Téléchargement de la mise à jour");
                    req.setNotificationVisibility(
                            DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    req.setDestinationInExternalPublicDir(
                            Environment.DIRECTORY_DOWNLOADS, filename);
                    DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    if (dm != null) {
                        dm.enqueue(req);
                        Toast.makeText(getApplicationContext(),
                                "Téléchargement de la mise à jour…",
                                Toast.LENGTH_SHORT).show();
                    }
                } catch (Exception e) {
                    // Last-resort fallback: hand the URL to the system
                    // browser via an ACTION_VIEW intent so the user still
                    // gets a working download path even if DownloadManager
                    // is unavailable on this device profile.
                    try {
                        android.content.Intent intent = new android.content.Intent(
                                android.content.Intent.ACTION_VIEW, Uri.parse(url));
                        intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                    } catch (Exception ignored) { /* nothing else we can do */ }
                }
            }
        });

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
