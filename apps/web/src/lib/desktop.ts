/**
 * Bridge to the TeamOS desktop shell in `apps/desktop`.
 *
 * The shell is a Tauri window that loads this web app from the instance URL, so
 * the same bundle runs in a browser and on the desktop. Every call here resolves
 * to `null` in a browser, which lets callers ask for a desktop behaviour without
 * branching first.
 *
 * These commands are only reachable because the shell grants this origin IPC
 * access in its remote capability. That grant is deliberately short: the page
 * can announce things and start a sign-in, and nothing else.
 */

/** URL scheme the desktop app registers. Must match `apps/desktop/src-tauri/tauri.conf.json`. */
export const DESKTOP_SCHEME = "teamos";

type TauriGlobal = {
  core?: {
    invoke?: (
      command: string,
      args?: Record<string, unknown>,
    ) => Promise<unknown>;
  };
};

function getTauri(): TauriGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { __TAURI__?: TauriGlobal }).__TAURI__;
}

/** True when this page is running inside the desktop shell. */
export function isDesktop(): boolean {
  return typeof getTauri()?.core?.invoke === "function";
}

async function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  const core = getTauri()?.core;
  if (typeof core?.invoke !== "function") return null;

  try {
    return (await core.invoke(command, args)) as T;
  } catch (error) {
    // A desktop command failing should never take the page down with it.
    console.error(`Desktop command "${command}" failed`, error);
    return null;
  }
}

/**
 * Opens the system browser on this instance's desktop sign-in page. The browser
 * hands the session back over the `teamos://` deep link, so the user signs in
 * with every method the instance offers rather than a stripped-down form.
 */
export function startDesktopLogin(): Promise<null> {
  return invoke<null>("desktop_start_login");
}

export type DesktopNotification = {
  title: string;
  body: string;
};

export function desktopNotify(
  notification: DesktopNotification,
): Promise<null> {
  return invoke<null>("desktop_notify", { notification });
}

/** Unread count for the taskbar badge and the tray tooltip. 0 clears it. */
export function desktopSetBadge(count: number): Promise<null> {
  return invoke<null>("desktop_set_badge", { count });
}

/**
 * Whether the shell's window is in front of the user right now. The webview's
 * own `document.hasFocus()` is not enough: a window hidden to the tray still
 * reports focus on some platforms.
 */
export function desktopIsForeground(): Promise<boolean | null> {
  return invoke<boolean>("desktop_is_foreground");
}
