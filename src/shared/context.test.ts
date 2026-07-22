import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./contracts.js";
import { compactActionLedger, compactChatHistory } from "./context.js";

function message(index: number, content: string): ChatMessage {
  return {
    id: String(index),
    role: index % 2 ? "assistant" : "user",
    content,
    createdAt: index,
  };
}

describe("compactChatHistory", () => {
  it("keeps the latest request while replacing older dialogue with bounded memory", () => {
    const history = Array.from({ length: 24 }, (_, index) => message(index, `message-${index} ${"detail ".repeat(180)}`));
    const compacted = compactChatHistory(history);
    const combined = compacted.map((entry) => entry.content).join("\n");

    expect(compacted.length).toBeLessThanOrEqual(7);
    expect(combined).toContain("Compact session memory");
    expect(combined).toContain("message-23");
    expect(combined.length).toBeLessThanOrEqual(10_500);
  });

  it("does not add a memory message to a short conversation", () => {
    const compacted = compactChatHistory([message(0, "Do the thing"), message(1, "Done")]);
    expect(compacted.map((entry) => entry.content)).toEqual(["Do the thing", "Done"]);
  });
});

describe("compactActionLedger", () => {
  it("keeps recent action outcomes within a small fixed budget", () => {
    const result = compactActionLedger(Array.from({ length: 30 }, (_, index) => `action ${index} ${"result ".repeat(100)}`));
    expect(result).toContain("earlier actions compacted");
    expect(result).toContain("action 29");
    expect(result.length).toBeLessThanOrEqual(2_600);
  });
});
