import { useEffect } from 'react';
import { useRouter, type Href } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { registerForPush, routeFromNotification } from './push';

/**
 * Mounted only while signed in (see app/_layout.tsx). Registers this phone for push notifications (asking for
 * permission the first time), keeps the server's copy of the token current, and opens the event a tapped
 * notification is about. A notification tapped while signed out is opened after sign-in.
 */
export function PushBridge() {
  const router = useRouter();
  const response = Notifications.useLastNotificationResponse();

  useEffect(() => {
    void registerForPush(true);
    // The OS can rotate the token; send the new one.
    const sub = Notifications.addPushTokenListener(() => { void registerForPush(false); });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const route = routeFromNotification(response.notification.request.content.data);
    Notifications.clearLastNotificationResponse();
    if (route) router.push(route as Href);
  }, [response, router]);

  return null;
}
