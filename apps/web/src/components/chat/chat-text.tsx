import { Link } from "@tanstack/react-router";
import { FolderKanban, SquareCheck } from "lucide-react";
import { type ChatPart, parseChatBody } from "@/lib/chat-mentions";
import { cn } from "@/lib/cn";

const chip =
  "mx-0.5 inline-flex max-w-full items-baseline gap-1 rounded-md px-1.5 py-px align-baseline text-[0.92em] font-medium transition-colors";

function MentionChip({
  part,
  workspaceId,
  meId,
}: {
  part: Extract<ChatPart, { type: "mention" }>;
  workspaceId?: string;
  meId?: string;
}) {
  if (part.kind === "user") {
    const isMe = part.id === meId;
    const className = cn(
      chip,
      isMe
        ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
        : "bg-sky-500/15 text-sky-700 hover:bg-sky-500/25 dark:text-sky-300",
    );
    return workspaceId ? (
      <Link
        to="/dashboard/workspace/$workspaceId/people/$userId"
        params={{ workspaceId, userId: part.id }}
        className={className}
      >
        @{part.label}
      </Link>
    ) : (
      <span className={className}>@{part.label}</span>
    );
  }

  const Icon = part.kind === "task" ? SquareCheck : FolderKanban;
  const className = cn(
    chip,
    "bg-primary/10 text-foreground hover:bg-primary/20",
  );
  const body = (
    <>
      <Icon className="size-3 shrink-0 self-center text-muted-foreground" />
      <span className="truncate">{part.label}</span>
    </>
  );
  if (!workspaceId) return <span className={className}>{body}</span>;
  return part.kind === "task" && part.projectId ? (
    <Link
      to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
      params={{ workspaceId, projectId: part.projectId, taskId: part.id }}
      className={className}
    >
      {body}
    </Link>
  ) : (
    <Link
      to="/dashboard/workspace/$workspaceId/project/$projectId/board"
      params={{ workspaceId, projectId: part.id }}
      className={className}
    >
      {body}
    </Link>
  );
}

/** A chat body with links and @mentions rendered; everything else is text. */
export function ChatText({
  body,
  workspaceId,
  meId,
}: {
  body: string;
  workspaceId?: string;
  meId?: string;
}) {
  return (
    <>
      {parseChatBody(body).map((part, index) =>
        part.type === "mention" ? (
          <MentionChip
            // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
            key={index}
            part={part}
            workspaceId={workspaceId}
            meId={meId}
          />
        ) : part.type === "link" ? (
          <a
            // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
            key={index}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="break-all text-sky-600 underline-offset-2 hover:underline dark:text-sky-400"
          >
            {part.value}
          </a>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
          <span key={index}>{part.value}</span>
        ),
      )}
    </>
  );
}
