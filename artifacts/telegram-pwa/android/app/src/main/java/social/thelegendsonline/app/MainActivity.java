package social.thelegendsonline.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;

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
