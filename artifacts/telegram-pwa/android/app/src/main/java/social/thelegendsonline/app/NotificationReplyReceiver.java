package social.thelegendsonline.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.text.TextUtils;
import android.widget.Toast;

import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.RemoteInput;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.Executors;

import org.json.JSONObject;

/**
 * Handles the inline RemoteInput "Répondre" action AND the "Marquer
 * comme lu" action posted by FcmMessagingService.
 *
 * Both actions run completely outside the WebView — perfect for keeping
 * the UX snappy (no app cold-start) AND for surviving cases where the
 * user has the app swiped away. We POST directly to the REST API using
 * the auth token mirrored into SharedPreferences by AuthBridgePlugin.
 *
 * On success we update the existing notification to inline-echo the
 * user's reply (matches WhatsApp) and reschedule a clear after a few
 * seconds. On failure we toast a short error and re-fire the original
 * notification so the user can retry.
 */
public class NotificationReplyReceiver extends BroadcastReceiver {

    public static final String ACTION_REPLY = "social.thelegendsonline.app.NOTIFICATION_REPLY";
    public static final String ACTION_MARK_READ = "social.thelegendsonline.app.MARK_READ";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (action == null) return;
        final Context appCtx = context.getApplicationContext();

        final int conversationId = intent.getIntExtra(
                FcmMessagingService.EXTRA_CONVERSATION_ID, -1);
        if (conversationId <= 0) return;

        if (ACTION_MARK_READ.equals(action)) {
            // Best-effort — just clear the bubble and ping the server.
            NotificationManagerCompat.from(appCtx).cancel(conversationId);
            FcmMessagingService.clearThread(appCtx, conversationId);
            Executors.newSingleThreadExecutor().execute(() ->
                    postMarkRead(appCtx, conversationId));
            return;
        }

        if (!ACTION_REPLY.equals(action)) return;

        Bundle results = RemoteInput.getResultsFromIntent(intent);
        if (results == null) return;
        CharSequence reply = results.getCharSequence(FcmMessagingService.KEY_REMOTE_REPLY);
        if (reply == null || TextUtils.isEmpty(reply.toString().trim())) return;

        final String text = reply.toString().trim();
        final boolean isGroup = intent.getBooleanExtra(
                FcmMessagingService.EXTRA_IS_GROUP, false);
        final String conversationTitle = intent.getStringExtra(
                FcmMessagingService.EXTRA_CONVERSATION_TITLE);
        final String senderName = intent.getStringExtra(
                FcmMessagingService.EXTRA_SENDER_NAME);

        // Optimistically echo the reply into the MessagingStyle thread
        // BEFORE the network round-trip — matches WhatsApp's "instant"
        // feel. If the POST fails we re-post the notification with an
        // error pill at the bottom (not implemented as a separate
        // notification — keeps the tray clean).
        FcmMessagingService.appendOwnReply(appCtx, conversationId, text,
                isGroup, conversationTitle, senderName);

        Executors.newSingleThreadExecutor().execute(() -> {
            boolean ok = postReply(appCtx, conversationId, text);
            if (!ok) {
                // Re-post the notification with the unsent reply prefixed
                // so the user knows it didn't go through. No toast (the
                // user might be on a locked screen — toasts are invisible
                // there).
                FcmMessagingService.appendOwnReply(appCtx, conversationId,
                        "⚠️ Non envoyé : " + text, isGroup,
                        conversationTitle, senderName);
            }
        });
    }

    private static boolean postReply(Context ctx, int conversationId, String text) {
        String token = AuthBridgePlugin.readToken(ctx);
        if (TextUtils.isEmpty(token)) {
            // No token — the user is signed out. Nothing else we can do
            // from a background receiver; the app will resync on next
            // foreground.
            return false;
        }
        String baseUrl = AuthBridgePlugin.readBaseUrl(ctx);
        String endpoint = baseUrl.replaceAll("/+$", "")
                + "/api/conversations/" + conversationId + "/messages";

        HttpURLConnection conn = null;
        try {
            URL u = new URL(endpoint);
            conn = (HttpURLConnection) u.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(8_000);
            conn.setReadTimeout(10_000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setRequestProperty("Authorization", "Bearer " + token);

            JSONObject body = new JSONObject();
            body.put("content", text);

            OutputStream os = conn.getOutputStream();
            try {
                os.write(body.toString().getBytes("UTF-8"));
                os.flush();
            } finally {
                try { os.close(); } catch (Exception ignored) {}
            }

            int code = conn.getResponseCode();
            return code >= 200 && code < 300;
        } catch (Exception e) {
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static void postMarkRead(Context ctx, int conversationId) {
        String token = AuthBridgePlugin.readToken(ctx);
        if (TextUtils.isEmpty(token)) return;
        String baseUrl = AuthBridgePlugin.readBaseUrl(ctx);
        String endpoint = baseUrl.replaceAll("/+$", "")
                + "/api/conversations/" + conversationId + "/read";
        HttpURLConnection conn = null;
        try {
            URL u = new URL(endpoint);
            conn = (HttpURLConnection) u.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(6_000);
            conn.setReadTimeout(6_000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setRequestProperty("Authorization", "Bearer " + token);
            conn.getOutputStream().write("{}".getBytes("UTF-8"));
            conn.getResponseCode(); // fire and forget
        } catch (Exception ignored) {
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
