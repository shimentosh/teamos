/**
 * OS-level notifications for notifications that arrive while TeamOS is in the
 * background — a minimized desktop window, or a browser tab the user is not
 * looking at. In the foreground the in-app bell is enough, and a second
 * notification on top of it is noise.
 *
 * The desktop shell raises these through Tauri; a browser uses the Notification
 * API. Both paths are best-effort: a blocked permission or a missing shell
 * leaves the in-app bell as the only signal, which is what happens today.
 */

import { desktopIsForeground, desktopNotify, isDesktop } from "./desktop";

export type IncomingNotification = {
  title?: string | null;
  content?: string | null;
};

const PERMISSION_ASKED_KEY = "teamos:notification-permission-asked";

function hasBrowserNotifications(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/**
 * Whether the app is out of sight and an OS notification is warranted.
 *
 * `document.hasFocus()` alone is not enough in the desktop shell: a window
 * hidden to the tray can still report focus, so the shell is asked directly
 * and only falls back to the document when it cannot answer.
 */
async function isInBackground(): Promise<boolean> {
  if (isDesktop()) {
    const foreground = await desktopIsForeground();
    if (foreground !== null) return !foreground;
  }

  if (typeof document === "undefined") return false;
  return document.visibilityState === "hidden" || !document.hasFocus();
}

/**
 * Asks for notification permission once, and only from inside a user gesture —
 * Safari requires one and Chrome holds prompts without one against the site.
 * Returns whether notifications can be shown now.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  // The shell owns permission on the desktop; the OS does not gate us here.
  if (isDesktop()) return true;
  if (!hasBrowserNotifications()) return false;

  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;

  try {
    if (localStorage.getItem(PERMISSION_ASKED_KEY) === "1") return false;
    localStorage.setItem(PERMISSION_ASKED_KEY, "1");
  } catch {
    // Private mode or blocked storage: asking once per page load is fine.
  }

  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

function fallbackTitle(notification: IncomingNotification): string {
  return notification.title?.trim() || "TeamOS";
}

function fallbackBody(notification: IncomingNotification): string {
  const content = notification.content?.trim();
  if (content) return content;
  // A notification with no body still deserves to reach the user; the bell
  // has the detail.
  return notification.title?.trim() ? "" : "You have a new notification";
}

export async function showOsNotification(
  notification: IncomingNotification,
): Promise<void> {
  if (!(await isInBackground())) return;

  const title = fallbackTitle(notification);
  const body = fallbackBody(notification);

  if (isDesktop()) {
    await desktopNotify({ title, body });
    return;
  }

  if (!hasBrowserNotifications() || Notification.permission !== "granted") {
    return;
  }

  try {
    const shown = new Notification(title, {
      body,
      // Replaces an earlier unread notification rather than stacking, so a
      // burst of activity does not bury the screen.
      tag: "teamos-notification",
      renotify: true,
    } as NotificationOptions);

    shown.onclick = () => {
      window.focus();
      window.dispatchEvent(new CustomEvent("teamos:open-notifications"));
      shown.close();
    };
  } catch {
    // Some browsers throw when the page is not in a service-worker context.
  }
}
