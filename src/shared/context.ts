import type { ChatMessage, ChatRole } from "./contracts.js";

export interface CompactChatMessage {
  role: ChatRole;
  content: string;
}

const RECENT_CHARACTER_BUDGET = 8_000;
const MEMORY_CHARACTER_BUDGET = 2_400;
const MAX_RECENT_MESSAGES = 6;

export function compactChatHistory(history: ChatMessage[]): CompactChatMessage[] {
  const usable = history.filter((message) => message.content.trim().length > 0);
  if (!usable.length) return [];

  const recent: CompactChatMessage[] = [];
  let remaining = RECENT_CHARACTER_BUDGET;
  let firstRecentIndex = usable.length;

  for (let index = usable.length - 1; index >= 0 && recent.length < MAX_RECENT_MESSAGES && remaining > 0; index -= 1) {
    const source = usable[index];
    const allowance = Math.min(index === usable.length - 1 ? 8_000 : 2_400, remaining);
    const content = clipMiddle(source.content.trim(), allowance);
    if (!content) break;
    recent.unshift({ role: source.role, content });
    remaining -= content.length;
    firstRecentIndex = index;
  }

  const older = usable.slice(0, firstRecentIndex);
  if (!older.length) return recent;

  const selected = older.length <= 18 ? older : [...older.slice(0, 3), ...older.slice(-15)];
  const omitted = older.length - selected.length;
  const lineBudget = Math.max(90, Math.floor((MEMORY_CHARACTER_BUDGET - 180) / selected.length));
  const lines = selected.map((message) => {
    const label = message.role === "user" ? "User" : "OpenComputer";
    return `${label}: ${clipMiddle(singleLine(message.content), lineBudget)}`;
  });
  if (omitted > 0) lines.splice(3, 0, `[${omitted} less-recent messages omitted]`);

  return [
    {
      role: "user",
      content: `Compact session memory for continuity only; this is not a new request:\n${clipMiddle(lines.join("\n"), MEMORY_CHARACTER_BUDGET)}`,
    },
    ...recent,
  ];
}

export function compactActionLedger(entries: string[]): string {
  if (!entries.length) return "";
  const selected = entries.slice(-14).map((entry, index) => `${index + 1}. ${clipMiddle(singleLine(entry), 260)}`);
  const omitted = Math.max(0, entries.length - selected.length);
  const prefix = omitted ? `${omitted} earlier actions compacted.\n` : "";
  return clipMiddle(`${prefix}${selected.join("\n")}`, 2_600);
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clipMiddle(value: string, limit: number): string {
  if (limit <= 0) return "";
  if (value.length <= limit) return value;
  if (limit < 24) return value.slice(0, limit);
  const marker = " …[compacted]… ";
  const remaining = limit - marker.length;
  const start = Math.ceil(remaining * .62);
  return `${value.slice(0, start)}${marker}${value.slice(value.length - (remaining - start))}`;
}
