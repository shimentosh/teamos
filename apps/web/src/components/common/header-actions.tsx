import { AskTeamOsButton } from "@/components/ai/ask-teamos";
import NotificationDropdown from "@/components/notification/notification-dropdown";
import { UserAvatar } from "@/components/user-avatar";

// Rendered by every Layout.Header so Ask TeamOS, notifications and the account
// menu sit at the top right of the page instead of in the sidebar.
export function HeaderActions() {
  return (
    <div className="ml-auto flex shrink-0 items-center gap-1 self-center">
      <AskTeamOsButton />
      <NotificationDropdown />
      <UserAvatar />
    </div>
  );
}
