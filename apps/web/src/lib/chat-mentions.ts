import { linkify, type TextPart } from "@/lib/linkify";

// Chat bodies stay plain text. A mention is stored inline as
// `@[label](kind:ref)` so it survives edits and needs no schema; the label is
// what readers see and the ref is what the chip links to. Task refs carry the
// project id too, since the task route needs both.
export type MentionKind = "user" | "project" | "task";

export type Mention = {
  kind: MentionKind;
  label: string;
  id: string;
  projectId?: string;
};

export type ChatPart = TextPart | ({ type: "mention" } & Mention);

const TOKEN =
  /@\[([^\]\n]{1,120})\]\((user|project|task):([\w-]+)(?:\/([\w-]+))?\)/g;

/** Labels can't contain the characters that delimit a token. */
function cleanLabel(label: string) {
  return label
    .replace(/[[\]()\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function mentionToken(mention: Mention) {
  const ref =
    mention.kind === "task" && mention.projectId
      ? `${mention.projectId}/${mention.id}`
      : mention.id;
  return `@[${cleanLabel(mention.label)}](${mention.kind}:${ref})`;
}

/** What the composer shows in place of a token. */
export function mentionDisplay(mention: Mention) {
  return `@${cleanLabel(mention.label)}`;
}

function parseMatch(match: RegExpMatchArray): Mention {
  const [, label = "", kind, first = "", second] = match;
  return kind === "task" && second
    ? { kind: "task", label, projectId: first, id: second }
    : { kind: kind as MentionKind, label, id: first };
}

/** Text, links and mentions, in order. Never produces HTML. */
export function parseChatBody(text: string): ChatPart[] {
  const parts: ChatPart[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    if (start > last) parts.push(...linkify(text.slice(last, start)));
    parts.push({ type: "mention", ...parseMatch(match) });
    last = start + match[0].length;
  }
  if (last < text.length) parts.push(...linkify(text.slice(last)));
  return parts;
}

/** A body with tokens shown as `@label`, for previews and reply quotes. */
export function chatPlainText(text: string) {
  return text.replace(TOKEN, (_match, label: string) => `@${label}`);
}

/**
 * Turns a stored body into what the composer shows, plus the mentions it
 * contains, so an edit can be saved back with its tokens intact.
 */
export function toComposerText(body: string) {
  const mentions: Mention[] = [];
  const text = body.replace(TOKEN, (...args) => {
    const mention = parseMatch(args as unknown as RegExpMatchArray);
    mentions.push(mention);
    return mentionDisplay(mention);
  });
  return { text, mentions };
}

/**
 * Swaps each mention's display text back to its token. A mention whose text
 * the person has since edited no longer matches and simply stays plain text.
 */
export function fromComposerText(text: string, mentions: Mention[]) {
  // Longest first, so "@Ann Lee" is not consumed by an "@Ann" mention.
  const ordered = [...mentions].sort(
    (a, b) => mentionDisplay(b).length - mentionDisplay(a).length,
  );
  let out = text;
  for (const mention of ordered) {
    out = out.split(mentionDisplay(mention)).join(mentionToken(mention));
  }
  return out;
}

/** The `@query` being typed right before the caret, if any. */
export function activeMentionQuery(text: string, caret: number) {
  const before = text.slice(0, caret);
  const match = /(?:^|\s)@([^\s@[\]()]{0,40})$/.exec(before);
  if (!match) return null;
  const query = match[1] ?? "";
  return { query, start: caret - query.length - 1 };
}
