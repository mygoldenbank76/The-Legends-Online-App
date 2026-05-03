package social.thelegendsonline.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import androidx.core.app.RemoteInput;
import androidx.core.graphics.drawable.IconCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Receives FCM data-only messages and renders rich, stackable
 * MessagingStyle notifications with an inline RemoteInput "Répondre"
 * action — same UX as WhatsApp / Telegram / native Messages.
 *
 * Stacking strategy:
 *   • Each conversation gets a notification with id = conversationId.
 *     Posting again with the same id REPLACES the previous bubble (so
 *     spamming 10 messages from one sender doesn't drown the tray) AND
 *     appends each new line to the MessagingStyle thread, exactly like
 *     a real chat.
 *   • All notifications share the GROUP_KEY so Android's auto-bundle
 *     UI shows a stack ("3 nouveaux messages dans 2 conversations")
 *     when more than one conversation has unread bubbles.
 *   • A SUMMARY notification with id = SUMMARY_ID is always posted
 *     alongside; it never appears alone but is required by Android to
 *     render the stack. swipe-dismissing the summary clears all.
 *
 * The unread thread for each conversation is persisted in
 * SharedPreferences as a JSON array so the next push can append to
 * the existing thread even if our process was killed in between.
 */
public class FcmMessagingService extends FirebaseMessagingService {

    private static final String CHANNEL_ID = "messages";
    private static final String GROUP_KEY = "social.thelegendsonline.app.MESSAGES";
    private static final int SUMMARY_ID = 100_000;
    // Bitmap cache scoped to the process — a single sender's avatar is
    // fetched once per cold start and reused across every subsequent
    // notification from them. Keeps the receiver path snappy without
    // bringing in a full image-loading dependency.
    private static final ConcurrentHashMap<String, Bitmap> AVATAR_CACHE =
            new ConcurrentHashMap<>();

    public static final String EXTRA_CONVERSATION_ID = "conversationId";
    public static final String EXTRA_MESSAGE_ID = "messageId";
    public static final String EXTRA_IS_GROUP = "isGroup";
    public static final String EXTRA_CONVERSATION_TITLE = "conversationTitle";
    public static final String EXTRA_SENDER_NAME = "senderName";
    public static final String EXTRA_TYPE = "type";

    public static final String KEY_REMOTE_REPLY = "key_remote_reply";

    private static final String PREFS = "legends_notifications";
    private static final String KEY_THREAD_PREFIX = "thread_";

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannel(this);
    }

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        // Capacitor's @capacitor/push-notifications plugin registers
        // tokens via FirebaseMessaging.getToken() at JS-level register()
        // time, so we don't need to re-broadcast here. The plugin will
        // pick up the rotated token on its next register() call (the
        // app does that on every cold start in use-fcm.ts).
    }

    @Override
    public void onMessageReceived(RemoteMessage remote) {
        Map<String, String> data = remote.getData();
        if (data == null || data.isEmpty()) return;

        // Only handle our chat notifications here — call notifications
        // and other types fall through to the default channel for now
        // so we don't accidentally mute them.
        String type = data.get("type");
        if (type != null && type.equals("incoming_call")) {
            postCallNotification(data);
            return;
        }

        String convIdStr = data.get("conversationId");
        if (TextUtils.isEmpty(convIdStr)) return;
        int conversationId;
        try { conversationId = Integer.parseInt(convIdStr); }
        catch (NumberFormatException e) { return; }

        String body = nullToEmpty(data.get("body"));
        String senderName = nullToEmpty(data.get("senderName"));
        String conversationTitle = nullToEmpty(data.get("conversationTitle"));
        boolean isGroup = "1".equals(data.get("isGroup")) || "true".equalsIgnoreCase(data.get("isGroup"));
        String senderAvatar = data.get("senderAvatar");
        String messageIdStr = data.get("messageId");

        // Append this message to the persisted thread for the conversation.
        List<JSONObject> thread = loadThread(conversationId);
        JSONObject msg = new JSONObject();
        try {
            msg.put("text", body);
            msg.put("sender", senderName);
            msg.put("ts", System.currentTimeMillis());
        } catch (JSONException ignored) { /* never happens for primitives */ }
        thread.add(msg);
        // Cap the thread at 8 entries — beyond that MessagingStyle
        // truncates anyway and we don't want SharedPreferences growing
        // unbounded for a single very chatty conversation.
        while (thread.size() > 8) thread.remove(0);
        saveThread(conversationId, thread);

        // Try to load the sender avatar (off the main thread is fine —
        // the FCM service runs on a worker thread). We block briefly so
        // the very first notification already has the right icon. If
        // anything fails we fall through with a null bitmap and Android
        // will use generic letter initials.
        Bitmap avatar = null;
        if (!TextUtils.isEmpty(senderAvatar)) {
            avatar = AVATAR_CACHE.get(senderAvatar);
            if (avatar == null) {
                avatar = downloadBitmap(senderAvatar);
                if (avatar != null) AVATAR_CACHE.put(senderAvatar, avatar);
            }
        }

        Notification n = buildMessagingNotification(
                conversationId,
                isGroup ? conversationTitle : senderName,
                isGroup,
                thread,
                avatar,
                messageIdStr,
                false);
        Notification summary = buildSummary();

        NotificationManagerCompat nm = NotificationManagerCompat.from(this);
        try {
            nm.notify(conversationId, n);
            nm.notify(SUMMARY_ID, summary);
        } catch (SecurityException ignored) {
            // POST_NOTIFICATIONS not granted on Android 13+ — nothing to do.
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Public — also called by NotificationReplyReceiver after a successful
    // reply so it can append the user's own outgoing message to the same
    // MessagingStyle thread (mimicking WhatsApp's "✓ Sent" inline echo).
    // ─────────────────────────────────────────────────────────────────────
    public static void appendOwnReply(Context ctx, int conversationId, String text,
                                      boolean isGroup, String conversationTitle, String senderName) {
        ensureChannel(ctx);
        List<JSONObject> thread = loadThreadStatic(ctx, conversationId);
        JSONObject msg = new JSONObject();
        try {
            msg.put("text", text);
            msg.put("sender", "");
            msg.put("ts", System.currentTimeMillis());
            msg.put("self", true);
        } catch (JSONException ignored) {}
        thread.add(msg);
        while (thread.size() > 8) thread.remove(0);
        saveThreadStatic(ctx, conversationId, thread);

        Notification n = buildMessagingNotificationStatic(ctx, conversationId,
                isGroup ? conversationTitle : senderName, isGroup, thread, null, null, true);
        try {
            NotificationManagerCompat.from(ctx).notify(conversationId, n);
        } catch (SecurityException ignored) {}
    }

    // ─────────────────────────────────────────────────────────────────────

    private Notification buildMessagingNotification(int conversationId, String title,
                                                    boolean isGroup, List<JSONObject> thread,
                                                    Bitmap avatar, String messageIdStr,
                                                    boolean replySent) {
        return buildMessagingNotificationStatic(this, conversationId, title, isGroup, thread,
                avatar, messageIdStr, replySent);
    }

    private static Notification buildMessagingNotificationStatic(Context ctx, int conversationId,
                                                                  String title, boolean isGroup,
                                                                  List<JSONObject> thread,
                                                                  Bitmap avatar,
                                                                  String messageIdStr,
                                                                  boolean replySent) {
        Person self = new Person.Builder().setName("Vous").build();

        NotificationCompat.MessagingStyle style = new NotificationCompat.MessagingStyle(self)
                .setGroupConversation(isGroup);
        if (!TextUtils.isEmpty(title)) style.setConversationTitle(title);

        for (JSONObject m : thread) {
            String text = m.optString("text", "");
            long ts = m.optLong("ts", System.currentTimeMillis());
            boolean isSelf = m.optBoolean("self", false);
            Person sender;
            if (isSelf) {
                sender = self;
            } else {
                Person.Builder pb = new Person.Builder().setName(m.optString("sender", title));
                if (avatar != null) pb.setIcon(IconCompat.createWithBitmap(avatar));
                sender = pb.build();
            }
            style.addMessage(text, ts, isSelf ? null : sender);
        }

        Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);

        // Tap → opens MainActivity with deep-link extras
        Intent tap = new Intent(ctx, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra(EXTRA_CONVERSATION_ID, conversationId)
                .putExtra(EXTRA_IS_GROUP, isGroup)
                .putExtra(EXTRA_CONVERSATION_TITLE, title);
        if (!TextUtils.isEmpty(messageIdStr)) {
            tap.putExtra(EXTRA_MESSAGE_ID, messageIdStr);
        }
        PendingIntent tapPi = PendingIntent.getActivity(ctx, conversationId, tap,
                PendingIntent.FLAG_UPDATE_CURRENT | flagImmutable());

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setStyle(style)
                .setAutoCancel(true)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setSound(sound)
                .setContentIntent(tapPi)
                .setGroup(GROUP_KEY)
                .setOnlyAlertOnce(false)
                .setShowWhen(true)
                .setWhen(System.currentTimeMillis());

        if (avatar != null) b.setLargeIcon(avatar);

        // Inline RemoteInput "Répondre" action — works fully native on
        // Android 7+. The receiver POSTs to /api and updates this same
        // notification on success. We deliberately do NOT add it after
        // a reply was just sent so the user gets the "Envoyé ✓" feedback
        // for a moment before the next push (if any) brings the action
        // back.
        if (!replySent) {
            RemoteInput remoteInput = new RemoteInput.Builder(KEY_REMOTE_REPLY)
                    .setLabel("Répondre…")
                    .build();
            Intent replyIntent = new Intent(ctx, NotificationReplyReceiver.class)
                    .setAction(NotificationReplyReceiver.ACTION_REPLY)
                    .putExtra(EXTRA_CONVERSATION_ID, conversationId)
                    .putExtra(EXTRA_IS_GROUP, isGroup)
                    .putExtra(EXTRA_CONVERSATION_TITLE, title);
            PendingIntent replyPi = PendingIntent.getBroadcast(ctx,
                    conversationId, replyIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | flagMutable());
            NotificationCompat.Action replyAction = new NotificationCompat.Action.Builder(
                    R.mipmap.ic_launcher, "Répondre", replyPi)
                    .addRemoteInput(remoteInput)
                    .setAllowGeneratedReplies(true)
                    .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
                    .setShowsUserInterface(false)
                    .build();
            b.addAction(replyAction);

            // "Marquer comme lu" — fires the same receiver with a
            // different action so a one-tap dismissal also pings the
            // server (best-effort, no UI involved).
            Intent readIntent = new Intent(ctx, NotificationReplyReceiver.class)
                    .setAction(NotificationReplyReceiver.ACTION_MARK_READ)
                    .putExtra(EXTRA_CONVERSATION_ID, conversationId);
            PendingIntent readPi = PendingIntent.getBroadcast(ctx,
                    conversationId + 1_000_000, readIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | flagImmutable());
            b.addAction(new NotificationCompat.Action.Builder(
                    R.mipmap.ic_launcher, "Lu", readPi).build());
        } else {
            b.setOngoing(false);
        }

        return b.build();
    }

    private Notification buildSummary() {
        Intent tap = new Intent(this, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tapPi = PendingIntent.getActivity(this, 0, tap,
                PendingIntent.FLAG_UPDATE_CURRENT | flagImmutable());
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("The Legends Online")
                .setContentText("Nouveaux messages")
                .setGroup(GROUP_KEY)
                .setGroupSummary(true)
                .setAutoCancel(true)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(tapPi)
                .build();
    }

    private void postCallNotification(Map<String, String> data) {
        String convIdStr = data.get("conversationId");
        if (TextUtils.isEmpty(convIdStr)) return;
        int conversationId;
        try { conversationId = Integer.parseInt(convIdStr); }
        catch (NumberFormatException e) { return; }

        String callerName = nullToEmpty(data.get("callerName"));
        boolean isVideo = "1".equals(data.get("isVideo"));
        String title = isVideo ? "📹 Appel vidéo entrant" : "📞 Appel entrant";
        String body = callerName + " vous appelle";

        Intent tap = new Intent(this, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra(EXTRA_CONVERSATION_ID, conversationId)
                .putExtra(EXTRA_TYPE, "incoming_call");
        PendingIntent tapPi = PendingIntent.getActivity(this, 200_000 + conversationId, tap,
                PendingIntent.FLAG_UPDATE_CURRENT | flagImmutable());

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setAutoCancel(true)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setFullScreenIntent(tapPi, true)
                .setContentIntent(tapPi)
                .setOngoing(true);

        try {
            NotificationManagerCompat.from(this).notify(900_000 + conversationId, b.build());
        } catch (SecurityException ignored) {}
    }

    public static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Messages",
                NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Nouveaux messages, appels et mentions");
        ch.enableLights(true);
        ch.enableVibration(true);
        ch.setShowBadge(true);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
    }

    // ── Thread persistence (SharedPreferences as a tiny KV) ────────────

    private List<JSONObject> loadThread(int conversationId) {
        return loadThreadStatic(this, conversationId);
    }

    private void saveThread(int conversationId, List<JSONObject> thread) {
        saveThreadStatic(this, conversationId, thread);
    }

    private static List<JSONObject> loadThreadStatic(Context ctx, int conversationId) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String raw = sp.getString(KEY_THREAD_PREFIX + conversationId, null);
        List<JSONObject> out = new ArrayList<>();
        if (raw == null) return out;
        try {
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                out.add(arr.getJSONObject(i));
            }
        } catch (JSONException ignored) {}
        return out;
    }

    private static void saveThreadStatic(Context ctx, int conversationId, List<JSONObject> thread) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONArray arr = new JSONArray();
        for (JSONObject m : thread) arr.put(m);
        sp.edit().putString(KEY_THREAD_PREFIX + conversationId, arr.toString()).apply();
    }

    public static void clearThread(Context ctx, int conversationId) {
        Context appCtx = ctx.getApplicationContext();
        appCtx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .remove(KEY_THREAD_PREFIX + conversationId)
                .apply();
    }

    // ── Helpers ────────────────────────────────────────────────────────

    private static int flagImmutable() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                ? PendingIntent.FLAG_IMMUTABLE : 0;
    }

    private static int flagMutable() {
        // RemoteInput requires the PendingIntent to be MUTABLE on
        // Android 12+ so the system can attach the user's typed reply.
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                ? PendingIntent.FLAG_MUTABLE : 0;
    }

    private static String nullToEmpty(String s) { return s == null ? "" : s; }

    private static Bitmap downloadBitmap(String url) {
        HttpURLConnection conn = null;
        try {
            URL u = new URL(url);
            conn = (HttpURLConnection) u.openConnection();
            conn.setConnectTimeout(4_000);
            conn.setReadTimeout(4_000);
            conn.setInstanceFollowRedirects(true);
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) return null;
            InputStream in = conn.getInputStream();
            try {
                BitmapFactory.Options opts = new BitmapFactory.Options();
                opts.inPreferredConfig = Bitmap.Config.ARGB_8888;
                opts.inSampleSize = 2;
                return BitmapFactory.decodeStream(in, null, opts);
            } finally {
                try { in.close(); } catch (Exception ignored) {}
            }
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
