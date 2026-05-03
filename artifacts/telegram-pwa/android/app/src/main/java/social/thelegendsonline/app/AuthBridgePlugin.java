package social.thelegendsonline.app;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Tiny Capacitor bridge whose only job is to expose the JS-side auth
 * token (the Bearer used to call our REST API) to native Java code.
 *
 * Why we need it: the inline "Reply" RemoteInput on push notifications
 * runs in a BroadcastReceiver — outside the WebView, with no access to
 * localStorage or IndexedDB. To POST the typed reply to /api the
 * receiver needs a Bearer token NOW, synchronously, without booting the
 * WebView. We mirror the JS token into SharedPreferences once at login
 * (and clear it on logout) so the receiver can read it instantly.
 *
 * The base URL is mirrored too because in dev/staging it differs from
 * prod and we want the receiver to hit the same backend the user is
 * actually logged into.
 */
@CapacitorPlugin(name = "AuthBridge")
public class AuthBridgePlugin extends Plugin {

    public static final String PREFS_NAME = "legends_apk_state";
    public static final String KEY_TOKEN = "auth_token";
    public static final String KEY_BASE_URL = "api_base_url";
    public static final String KEY_USER_ID = "auth_user_id";

    @PluginMethod
    public void setToken(PluginCall call) {
        String token = call.getString("token");
        String baseUrl = call.getString("baseUrl");
        Integer userId = call.getInt("userId");
        SharedPreferences.Editor e = prefs().edit();
        if (token != null) e.putString(KEY_TOKEN, token); else e.remove(KEY_TOKEN);
        if (baseUrl != null) e.putString(KEY_BASE_URL, baseUrl);
        if (userId != null) e.putInt(KEY_USER_ID, userId); else e.remove(KEY_USER_ID);
        e.apply();
        call.resolve();
    }

    @PluginMethod
    public void clearToken(PluginCall call) {
        prefs().edit().remove(KEY_TOKEN).remove(KEY_USER_ID).apply();
        call.resolve();
    }

    @PluginMethod
    public void getToken(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("token", prefs().getString(KEY_TOKEN, null));
        ret.put("baseUrl", prefs().getString(KEY_BASE_URL, null));
        call.resolve(ret);
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    /** Static helper so the FCM service / reply receiver can read the token. */
    public static String readToken(Context ctx) {
        return ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getString(KEY_TOKEN, null);
    }

    public static String readBaseUrl(Context ctx) {
        return ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getString(KEY_BASE_URL, "https://thelegendsonline.social");
    }
}
