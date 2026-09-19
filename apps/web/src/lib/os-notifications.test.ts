import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const desktop = vi.hoisted(() => ({
  isDesktop: vi.fn(() => false),
  desktopIsForeground: vi.fn(async () => null as boolean | null),
  desktopNotify: vi.fn(async () => null),
}));

vi.mock("./desktop", () => desktop);

const { requestNotificationPermission, showOsNotification } = await import(
  "./os-notifications"
);

function installNotification(permission: NotificationPermission) {
  const constructed: { title: string; options?: NotificationOptions }[] = [];

  class FakeNotification {
    onclick: (() => void) | null = null;
    constructor(title: string, options?: NotificationOptions) {
      constructed.push({ title, options });
    }
    close() {}
    static permission: NotificationPermission = permission;
    static requestPermission = vi.fn(async () => "granted" as const);
  }

  vi.stubGlobal("Notification", FakeNotification);
  return { constructed, FakeNotification };
}

function setDocumentState(visible: boolean, focused: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (visible ? "visible" : "hidden"),
  });
  vi.spyOn(document, "hasFocus").mockReturnValue(focused);
}

const pretendForeground = () => setDocumentState(true, true);
const pretendBackground = () => setDocumentState(false, false);

beforeEach(() => {
  desktop.isDesktop.mockReturnValue(false);
  desktop.desktopIsForeground.mockResolvedValue(null);
  desktop.desktopNotify.mockClear();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("showOsNotification", () => {
  it("stays quiet while the user is looking at the app", async () => {
    const { constructed } = installNotification("granted");
    pretendForeground();

    await showOsNotification({ title: "Task assigned", content: "Ship it" });

    expect(constructed).toHaveLength(0);
  });

  it("raises a browser notification when the app is in the background", async () => {
    const { constructed } = installNotification("granted");
    pretendBackground();

    await showOsNotification({ title: "Task assigned", content: "Ship it" });

    expect(constructed).toHaveLength(1);
    expect(constructed[0].title).toBe("Task assigned");
    expect(constructed[0].options?.body).toBe("Ship it");
  });

  it("falls back to a usable title and body when the notification has neither", async () => {
    const { constructed } = installNotification("granted");
    pretendBackground();

    await showOsNotification({ title: null, content: null });

    expect(constructed[0].title).toBe("TeamOS");
    expect(constructed[0].options?.body).toBe("You have a new notification");
  });

  it("does nothing when the user blocked notifications", async () => {
    const { constructed } = installNotification("denied");
    pretendBackground();

    await showOsNotification({ title: "Task assigned", content: "Ship it" });

    expect(constructed).toHaveLength(0);
  });

  it("asks the shell about the window rather than the document on desktop", async () => {
    const { constructed } = installNotification("granted");
    desktop.isDesktop.mockReturnValue(true);
    // The document claims focus, but the window is hidden to the tray.
    desktop.desktopIsForeground.mockResolvedValue(false);

    await showOsNotification({ title: "Task assigned", content: "Ship it" });

    expect(desktop.desktopNotify).toHaveBeenCalledWith({
      title: "Task assigned",
      body: "Ship it",
    });
    expect(constructed).toHaveLength(0);
  });

  it("stays quiet on desktop while the window is in front", async () => {
    installNotification("granted");
    pretendBackground();
    desktop.isDesktop.mockReturnValue(true);
    desktop.desktopIsForeground.mockResolvedValue(true);

    await showOsNotification({ title: "Task assigned", content: "Ship it" });

    expect(desktop.desktopNotify).not.toHaveBeenCalled();
  });
});

describe("requestNotificationPermission", () => {
  it("asks once and remembers a dismissal", async () => {
    const { FakeNotification } = installNotification("default");

    await expect(requestNotificationPermission()).resolves.toBe(true);
    await expect(requestNotificationPermission()).resolves.toBe(false);

    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
  });

  it("does not ask again once granted", async () => {
    const { FakeNotification } = installNotification("granted");

    await expect(requestNotificationPermission()).resolves.toBe(true);

    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
  });

  it("needs no permission inside the desktop shell", async () => {
    desktop.isDesktop.mockReturnValue(true);

    await expect(requestNotificationPermission()).resolves.toBe(true);
  });
});
