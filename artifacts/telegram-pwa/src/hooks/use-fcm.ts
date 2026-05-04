import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications, type Token, type PushNotificationSchema, type ActionPerformed } from '@capacitor/push-notifications';
import { getAuthHeaders } from '@/lib/auth-fetch';

/**
 * Native FCM push notifications (Capacitor APK only). Silent no-op on web.
 *
 * Lifecycle:
 *  - Re-runs whenever the authenticated userId changes (login, logout +
 *    re-login as another account on the same device). The previous run's
 *    listeners are removed and a new register() pass remaps the token to
 *    the current user.
 *  - The "already registered" guard only kicks in AFTER the backend
 *    successfully stored the token. A failed POST resets the guard so the
 *    next render or a manual `register()` event retries.
 *
 * The OS draws the notification natively when the APK is fully closed (we
 * send `notification` + `data` from the server). Foreground delivery hits
 * the 'pushNotificationReceived' listener, where socket.io has already
 * surfaced the message in-app.
 */
// Minimum cooldown between consecutive FCM registration retries when the
// backend POST keeps failing. Without this, every parent re-render would
// re-trigger the whole permission/register/POST sequence and hammer the
// /api/push/fcm-register endpoint (and the push token broker itself).
const FCM_RETRY_COOLDOWN_MS = 60_000;

export function useFcm(opts: { userId: number | null }): void {
  const registeredForUserRef = useRef<number | null>(null);
  const lastFailedAttemptAtRef = useRef<number>(0);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const userId = opts.userId;
    if (userId == null) {
      // Logged out → forget who was registered so the next login re-runs
      // the registration flow against the new account.
      registeredForUserRef.current = null;
      lastFailedAttemptAtRef.current = 0;
      return;
    }
    if (registeredForUserRef.current === userId) return;
    // Back off if the previous attempt failed recently — avoids tight
    // retry loops if the backend is down or the device is offline.
    if (Date.now() - lastFailedAttemptAtRef.current < FCM_RETRY_COOLDOWN_MS) return;

    let cleanup: Array<() => void> = [];
    let cancelled = false;

    (async () => {
      try {
        let perm = await PushNotifications.checkPermissions();
        if (perm.receive !== 'granted') {
          perm = await PushNotifications.requestPermissions();
        }
        if (perm.receive !== 'granted') {
          console.warn('[fcm] permission not granted:', perm.receive);
          return;
        }
        if (cancelled) return;

        const regHandle = await PushNotifications.addListener('registration', async (t: Token) => {
          try {
            const r = await fetch('/api/push/fcm-register', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
              body: JSON.stringify({ token: t.value, platform: 'android' }),
            });
            if (!r.ok) throw new Error(`backend ${r.status}`);
            // Mark as registered ONLY after the backend confirms — so a
            // transient failure leaves us in a state where the next render
            // (or auth refresh) will retry.
            registeredForUserRef.current = userId;
            console.log('[fcm] token registered with backend for user', userId);
          } catch (err) {
            console.error('[fcm] failed to send token to backend:', err);
            registeredForUserRef.current = null;
            lastFailedAttemptAtRef.current = Date.now();
          }
        });
        cleanup.push(() => { void regHandle.remove(); });

        const errHandle = await PushNotifications.addListener('registrationError', (err) => {
          console.error('[fcm] registration error:', err);
          registeredForUserRef.current = null;
          lastFailedAttemptAtRef.current = Date.now();
        });
        cleanup.push(() => { void errHandle.remove(); });

        const recvHandle = await PushNotifications.addListener(
          'pushNotificationReceived',
          (n: PushNotificationSchema) => {
            // Re-broadcast as a window event so any open page (notably the
            // conversation list and the active chat area) can react —
            // socket.io is the primary channel for in-app updates, but
            // when a notification race-arrives BEFORE the socket frame we
            // still surface the toast / badge update from this listener.
            try {
              window.dispatchEvent(new CustomEvent('fcm:foreground', {
                detail: { title: n.title, body: n.body, data: n.data ?? {} },
              }));
            } catch { /* CustomEvent unavailable — extremely old WebView */ }
          }
        );
        cleanup.push(() => { void recvHandle.remove(); });

        const navigateToConversation = (data: Record<string, any>) => {
          const conversationId = data.conversationId;
          if (!conversationId) return;
          const isGroup = data.isGroup === '1' || data.isGroup === true;
          const params = new URLSearchParams({
            conv: String(conversationId),
            type: isGroup ? 'group' : 'direct',
          });
          if (data.messageId) params.set('msg', String(data.messageId));
          if (data.type === 'incoming_call') params.set('call', '1');
          try {
            sessionStorage.setItem('fcm:pending-nav', JSON.stringify({
              conv: String(conversationId),
              type: isGroup ? 'group' : 'direct',
              msg: data.messageId ? String(data.messageId) : undefined,
              call: data.type === 'incoming_call' ? '1' : undefined,
              ts: Date.now(),
            }));
          } catch { /* sessionStorage unavailable */ }
          const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
          window.location.href = `${base}/?${params.toString()}`;
        };

        const tapHandle = await PushNotifications.addListener(
          'pushNotificationActionPerformed',
          (action: ActionPerformed) => {
            navigateToConversation(action.notification.data ?? {});
          }
        );
        cleanup.push(() => { void tapHandle.remove(); });

        await PushNotifications.register();
        console.log('[fcm] register() called for user', userId);
      } catch (err) {
        console.error('[fcm] init failed:', err);
        registeredForUserRef.current = null;
        lastFailedAttemptAtRef.current = Date.now();
      }
    })();

    return () => {
      cancelled = true;
      cleanup.forEach((fn) => fn());
      cleanup = [];
    };
  }, [opts.userId]);
}
