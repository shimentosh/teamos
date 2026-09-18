import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationPreferencesSettings } from "./notification-preferences-settings";

const updatePreferences = vi.fn();
// The event switches save through the fetcher directly.
const saveEvent = vi.fn();
const preferences = {
  emailAddress: "mina@example.com",
  emailEnabled: false,
  ntfyEnabled: false,
  ntfyConfigured: false,
  ntfyServerUrl: null,
  ntfyTopic: null,
  ntfyTokenConfigured: false,
  maskedNtfyToken: null,
  gotifyEnabled: false,
  gotifyConfigured: false,
  gotifyServerUrl: null,
  gotifyTokenConfigured: false,
  maskedGotifyToken: null,
  webhookEnabled: false,
  webhookConfigured: false,
  webhookUrl: null,
  webhookSecretConfigured: false,
  maskedWebhookSecret: null,
  taskAssignmentEnabled: true,
  taskCommentEnabled: true,
  taskStatusChangeEnabled: true,
  dueDateReminderEnabled: true,
  dueDateReminderLeadTimeMinutes: 1440,
  events: [
    { key: "task_assigned", audience: "everyone", inApp: true, email: true },
    { key: "task_due", audience: "everyone", inApp: true, email: true },
    { key: "leave_requested", audience: "approvers", inApp: true, email: true },
  ],
  workspaces: [],
  createdAt: null,
  updatedAt: null,
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { event?: string }) =>
      options?.event ? `${key}:${options.event}` : key,
  }),
}));

vi.mock(
  "@/fetchers/notification-preferences/update-notification-preferences",
  () => ({ default: (json: unknown) => saveEvent(json) }),
);

let current = preferences;
function renderSettings(overrides: Partial<typeof preferences> = {}) {
  current = { ...preferences, ...overrides };
  const queryClient = new QueryClient();
  queryClient.setQueryData(["notification-preferences"], current);
  return render(
    <QueryClientProvider client={queryClient}>
      <NotificationPreferencesSettings />
    </QueryClientProvider>,
  );
}

vi.mock(
  "@/hooks/queries/notification-preferences/use-get-notification-preferences",
  () => ({
    default: () => ({
      data: current,
      isLoading: false,
    }),
  }),
);

// No workspace rules in these tests: every switch is the person's own.
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ workspace: undefined }),
}));

vi.mock("@/hooks/queries/use-notification-policy", () => ({
  useNotificationPolicies: () => ({ data: [] }),
}));

vi.mock("@/hooks/queries/workspace/use-get-workspaces", () => ({
  default: () => ({ data: [] }),
}));

vi.mock(
  "@/hooks/mutations/notification-preferences/use-notification-preferences",
  () => ({
    useUpdateNotificationPreferences: () => ({
      mutateAsync: updatePreferences,
      isPending: false,
    }),
    useUpsertNotificationWorkspaceRule: () => ({ mutateAsync: vi.fn() }),
    useDeleteNotificationWorkspaceRule: () => ({ mutateAsync: vi.fn() }),
  }),
);

describe("NotificationPreferencesSettings", () => {
  afterEach(cleanup);

  beforeEach(() => {
    updatePreferences.mockReset();
    updatePreferences.mockResolvedValue(undefined);
    saveEvent.mockReset();
    saveEvent.mockImplementation(async () => current);
  });

  const saveTiming = () =>
    screen.getByRole("button", {
      name: "settings:notificationsPage.saveReminderTiming",
    });
  const leadTime = () =>
    screen.getByLabelText("settings:notificationsPage.reminderLeadTimeLabel");
  const title = (key: string) =>
    `settings:notificationsPage.events.${key}.title`;

  it("saves the reminder lead time on its own", async () => {
    renderSettings();
    fireEvent.change(leadTime(), { target: { value: "2" } });
    fireEvent.click(saveTiming());

    await waitFor(() =>
      expect(updatePreferences).toHaveBeenCalledWith({
        dueDateReminderLeadTimeMinutes: 2880,
      }),
    );
  });

  it("blocks saving a cleared reminder lead time", () => {
    renderSettings();
    fireEvent.change(leadTime(), { target: { value: "" } });

    expect(
      screen.getByText("settings:notificationsPage.reminderLeadTimeInvalid"),
    ).toBeTruthy();
    expect(saveTiming()).toHaveProperty("disabled", true);
  });

  it("saves an event switch straight away", async () => {
    renderSettings();
    fireEvent.click(
      screen.getByRole("switch", {
        name: `settings:notificationsPage.inAppFor:${title("leave_requested")}`,
      }),
    );
    await waitFor(() =>
      expect(saveEvent).toHaveBeenCalledWith({
        events: { leave_requested: { inApp: false } },
      }),
    );
  });

  it("groups events by who receives them", () => {
    renderSettings();
    expect(
      screen.getByText("settings:notificationsPage.audience.everyone"),
    ).toBeTruthy();
    expect(
      screen.getByText("settings:notificationsPage.audience.approvers"),
    ).toBeTruthy();
    // No admin events in this list, so no empty admin group.
    expect(
      screen.queryByText("settings:notificationsPage.audience.admins"),
    ).toBeNull();
  });

  it("disables event emails while the email channel is off", () => {
    renderSettings({ emailEnabled: false });
    expect(
      screen.getByRole("switch", {
        name: `settings:notificationsPage.emailFor:${title("task_assigned")}`,
      }),
    ).toHaveAttribute("data-disabled");
  });

  it("leaves the lead time alone while due-date reminders are off", () => {
    renderSettings({
      events: preferences.events.map((event) =>
        event.key === "task_due" ? { ...event, inApp: false } : event,
      ),
    });
    expect(leadTime()).toHaveProperty("disabled", true);
    fireEvent.change(leadTime(), { target: { value: "0" } });
    expect(saveTiming()).toHaveProperty("disabled", false);
  });
});
