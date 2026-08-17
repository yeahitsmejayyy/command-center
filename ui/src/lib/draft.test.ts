import { describe, expect, test } from "bun:test";
import { isDirty } from "./draft.ts";
import type { Task } from "../api.ts";

function task(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "Write the parser",
    body: "Handle nested quotes.",
    status: "backlog",
    order: 0,
    createdAt: 0,
    startedAt: null,
    finishedAt: null,
    attempts: 0,
    planMode: false,
    sessionId: null,
    attachments: [],
    ...over,
  };
}

describe("isDirty", () => {
  test("an untouched draft is clean", () => {
    const t = task();
    expect(isDirty(t, { title: t.title, body: t.body, planMode: t.planMode })).toBe(false);
  });

  test("catches a changed title, body, or plan mode", () => {
    const t = task();
    const base = { title: t.title, body: t.body, planMode: t.planMode };

    expect(isDirty(t, { ...base, title: "Write the lexer" })).toBe(true);
    expect(isDirty(t, { ...base, body: "Handle nested quotes and escapes." })).toBe(true);
    expect(isDirty(t, { ...base, planMode: true })).toBe(true);
  });

  test("ignores whitespace the save would trim away", () => {
    // Save sends draft.title.trim(), so padding alone changes nothing. Warning
    // about it would train the user to dismiss the warning.
    const t = task();
    expect(isDirty(t, { title: `  ${t.title} `, body: `\n${t.body}\t`, planMode: t.planMode })).toBe(false);
  });

  test("emptying a field is a real change", () => {
    const t = task();
    expect(isDirty(t, { title: t.title, body: "   ", planMode: t.planMode })).toBe(true);
  });

  test("typing into a task that had no instructions is a real change", () => {
    const t = task({ body: "" });
    expect(isDirty(t, { title: t.title, body: "Start here.", planMode: t.planMode })).toBe(true);
  });
});
