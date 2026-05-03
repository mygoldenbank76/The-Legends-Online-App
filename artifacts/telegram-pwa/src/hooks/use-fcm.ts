import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications, type Token, type PushNotificationSchema, type ActionPerformed } from '@capacitor/push-notifications';
import { getAuthHeaders } from '@/lib/auth-fetch';

/**
 * Native FCM push notifications (Capacitor APK only). Silent no-op on web.
 *
 * Boot sequence:
 *  1. Skip if not native.
 *  2. Request POST_NOTIFICATIONS permission (Android 13+).
 *  3. Register with FCM → get token via 'registration' event.
 *  4. POST token to /api/push/fcm-register so the server can target this device.
 *  5. Listen for tap events → navigate into the conversation.
 *
 * The OS itself draws the notification when the APK is fully closed (we send
 * `notification` payload from server). When the app is in the foreground the
 * 'pushNotificationReceived' event fires instead — we just refresh the badge
 * and let socket.io handle the in-app delivery.
 */
export function useFcm(opts: { isAuthenticated: boolean }): void {
  const registeredRef = useRef(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (!opts.isAuthenticated) return;
    if (registeredRef.current) return;
    registeredRef.current = true;

    let cleanup: Array<() => void> = [];

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

        const regHandle = await PushNotifications.addListener('registration', async (t: Token) => {
          try {
            await fetch('/api/push/fcm-register', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
              body: JSON.stringify({ token: t.value, platform: 'android' }),
            });
            console.log('[fcm] token registered with backend');
          } catch (err) {
            console.error('[fcm] failed to send token to backend:', err);
          }
        });
        cleanup.push(() => { void regHandle.remove(); });

        const errHandle = await PushNotifications.addListener('registrationError', (err) => {
          console.error('[fcm] registration error:', err);
        });
        cleanup.push(() => { void errHandle.remove(); });

        const recvHandle = await PushNotifications.addListener(
          'pushNotificationReceived',
          (n: PushNotificationSchema) => {
            console.log('[fcm] foreground notification:', n.title);
          }
        );
        cleanup.push(() => { void recvHandle.remove(); });

        const tapHandle = await PushNotifications.addListener(
          'pushNotificationActionPerformed',
          (action: ActionPerformed) => {
            const data = action.notification.data ?? {};
            const conversationId = data.conversationId;
            if (conversationId) {
              const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
              window.location.href = `${base}/?conversation=${conversationId}`;
            }
          }
        );
        cleanup.push(() => { void tapHandle.remove(); });

        await PushNotifications.register();
        console.log('[fcm] register() called');
      } catch (err) {
        console.error('[fcm] init failed:', err);
      }
    })();

    return () => {
      cleanup.forEach((fn) => fn());
      cleanup = [];
    };
  }, [opts.isAuthenticated]);
}
