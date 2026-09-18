import { subscribeToEvent } from "../events";
import createNotification from "./controllers/create-notification";

type RoleChanged = {
  workspaceId: string;
  workspaceName: string;
  userId: string;
  oldRole: string;
  newRole: string;
};

type MemberRemoved = {
  workspaceId: string;
  workspaceName: string;
  userId: string;
};

// The person whose role changed hears about it; what they can do changed.
subscribeToEvent<RoleChanged>("member.role_changed", async (data) => {
  if (data.oldRole === data.newRole) return;
  await createNotification({
    userId: data.userId,
    type: "role_changed",
    eventData: { ...data },
    resourceId: data.workspaceId,
    resourceType: "workspace",
  });
});

// Removed people keep their account; tell them their access ended.
subscribeToEvent<MemberRemoved>("member.removed", async (data) => {
  await createNotification({
    userId: data.userId,
    type: "member_removed",
    eventData: { ...data },
    resourceId: data.workspaceId,
    resourceType: "workspace",
  });
});
