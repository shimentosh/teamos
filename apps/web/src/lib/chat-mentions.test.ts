import { describe, expect, it } from "vitest";
import {
  activeMentionQuery,
  chatPlainText,
  fromComposerText,
  mentionToken,
  parseChatBody,
  toComposerText,
} from "./chat-mentions";

const task = {
  kind: "task" as const,
  label: "MKT-4 Fix login",
  id: "t1",
  projectId: "p1",
};
const ann = { kind: "user" as const, label: "Ann", id: "u1" };
const annLee = { kind: "user" as const, label: "Ann Lee", id: "u2" };

describe("chat mentions", () => {
  it("round-trips a task token with its project", () => {
    const body = `see ${mentionToken(task)} now`;
    expect(body).toBe("see @[MKT-4 Fix login](task:p1/t1) now");
    expect(parseChatBody(body)).toEqual([
      { type: "text", value: "see " },
      { type: "mention", ...task },
      { type: "text", value: " now" },
    ]);
  });

  it("keeps links working around mentions", () => {
    const parts = parseChatBody(`${mentionToken(ann)} https://a.com`);
    expect(parts.map((p) => p.type)).toEqual(["mention", "text", "link"]);
  });

  it("strips token delimiters out of labels", () => {
    expect(
      mentionToken({ kind: "project", label: "Q3 [draft] (v2)", id: "p" }),
    ).toBe("@[Q3 draft v2](project:p)");
  });

  it("shows tokens as @label in previews", () => {
    expect(chatPlainText(`hi ${mentionToken(ann)}`)).toBe("hi @Ann");
  });

  it("converts composer text to tokens and back, longest name first", () => {
    const text = "@Ann Lee and @Ann, check @MKT-4 Fix login";
    const body = fromComposerText(text, [ann, annLee, task]);
    expect(body).toBe(
      "@[Ann Lee](user:u2) and @[Ann](user:u1), check @[MKT-4 Fix login](task:p1/t1)",
    );
    expect(toComposerText(body)).toEqual({
      text,
      mentions: [annLee, ann, task],
    });
  });

  it("leaves a mention whose text was edited as plain text", () => {
    expect(fromComposerText("@An", [ann])).toBe("@An");
  });

  it("finds the query being typed after @", () => {
    expect(activeMentionQuery("hey @fi", 7)).toEqual({ query: "fi", start: 4 });
    expect(activeMentionQuery("@", 1)).toEqual({ query: "", start: 0 });
    expect(activeMentionQuery("mail a@b", 8)).toBeNull();
    expect(activeMentionQuery("@ann done", 9)).toBeNull();
  });
});
