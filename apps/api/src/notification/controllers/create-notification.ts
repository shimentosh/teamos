import { createId } from "@paralleldrive/cuid2";
import db from "../../database";
import { notificationTable } from "../../database/schema";
import { publishEvent } from "../../events";
import {
  deliverEmailOnly,
  deliverNotification,
} from "../../notification-preferences/delivery";
import {
  effectiveEventEnabled,
  eventKeyOf,
} from "../../notification-preferences/events";
import {
  workspaceOfNotification,
  workspacePolicy,
} from "../../notification-preferences/policy";

async function createNotification({
  userId,
  title,
  content,
  type,
  eventData,
  resourceId,
  resourceType,
}: {
  userId: string;
  title?: string | null;
  content?: string | null;
  type?: string;
  eventData?: Record<string, unknown> | null;
  resourceId?: string;
  resourceType?: string;
}) {
  // People can switch any event off in the app (Settings → Account →
  // Notifications); email has its own switch, checked on delivery.
  const eventKey = eventKeyOf(type);
  if (eventKey) {
    const preference = await db.query.userNotificationPreferenceTable.findFirst(
      {
        where: (table, { eq }) => eq(table.userId, userId),
      },
    );

    // A workspace admin's rule can decide for everyone (Settings → Workspace
    // → Notifications); otherwise the person's own switch applies.
    const policy = await workspacePolicy(
      await workspaceOfNotification({ eventData, resourceType, resourceId }),
      eventKey,
    );

    if (!effectiveEventEnabled(eventKey, "inApp", preference, policy)) {
      // In-app off doesn't mean email off: the two switches are separate.
      if (effectiveEventEnabled(eventKey, "email", preference, policy)) {
        void deliverEmailOnly({
          id: createId(),
          userId,
          title: title ?? null,
          content: content ?? null,
          type: type || "info",
          eventData: eventData ?? null,
          resourceId: resourceId || null,
          resourceType: resourceType || null,
          isRead: false,
          createdAt: new Date(),
        } as typeof notificationTable.$inferSelect).catch((error) =>
          console.error("Failed to email a notification", error),
        );
      }
      return null;
    }
  }

  const [notification] = await db
    .insert(notificationTable)
    .values({
      id: createId(),
      userId,
      title: title ?? null,
      content: content ?? null,
      type: type || "info",
      eventData: eventData ?? null,
      resourceId: resourceId || null,
      resourceType: resourceType || null,
    })
    .returning();

  if (notification) {
    await publishEvent("notification.created", {
      notificationId: notification.id,
      userId,
    });
    void deliverNotification(notification.id).catch((error) => {
      console.error("Failed to deliver notification", {
        notificationId: notification.id,
        error,
      });
    });
  }

  return notification;
}

export default createNotification;
