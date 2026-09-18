import type { chatConversationTable } from "../database/schema";
import createNotification from "../notification/controllers/create-notification";

type Conversation = typeof chatConversationTable.$inferSelect;

// Mentions are stored inline in the body as `@[label](kind:ref)`; see
// apps/web/src/lib/chat-mentions.ts, which writes them.
const TOKEN =
  /@\[([^\]\n]{1,120})\]\((user|project|task):([\w-]+)(?:\/([\w-]+))?\)/g;

export function mentionedUserIds(body: string) {
  const ids = new Set<string>();
  for (const match of body.matchAll(TOKEN)) {
    if (match[2] === "user" && match[3]) ids.add(match[3]);
  }
  return [...ids];
}

/** The body as people read it: tokens shown as `@label`, trimmed. */
export function plainBody(body: string, max = 200) {
  const text = body
    .replace(TOKEN, (_match, label: string) => `@${label.trim() || "someone"}`)
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Tells each person @mentioned in a new message. Only members of the
 * conversation are told, so a private channel never leaks to outsiders by
 * a typed mention; the sender is never notified about themselves.
 */
export async function notifyMentions(input: {
  conversation: Conversation;
  members: string[];
  senderId: string;
  senderName: string;
  body: string;
}) {
  const allowed = new Set(input.members);
  const targets = mentionedUserIds(input.body).filter(
    (id) => id !== input.senderId && allowed.has(id),
  );
  if (targets.length === 0) return;
  const conversationTitle =
    input.conversation.type === "channel" && input.conversation.name
      ? `#${input.conversation.name}`
      : null;
  const excerpt = plainBody(input.body);
  await Promise.all(
    targets.map((userId) =>
      createNotification({
        userId,
        type: "chat_mention",
        title: `${input.senderName} mentioned you`,
        content: excerpt,
        eventData: {
          workspaceId: input.conversation.workspaceId,
          conversationId: input.conversation.id,
          conversationTitle,
          senderName: input.senderName,
          excerpt,
        },
        resourceId: input.conversation.id,
        resourceType: "chat",
      }),
    ),
  );
}
