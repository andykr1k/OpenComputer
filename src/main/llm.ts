import { randomUUID } from "node:crypto";
import type { AppSettings, ChatMessage } from "../shared/contracts.js";
import { compactActionLedger, compactChatHistory } from "../shared/context.js";
import { chatCompletionsUrl } from "../shared/settings.js";
import type { DesktopAutomation, ToolCall } from "./automation.js";

type ModelContent = string | Array<Record<string, unknown>>;

interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: ModelContent | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface CompletionResponse {
  choices?: Array<{ message?: ModelMessage }>;
  error?: { message?: string };
}

const SYSTEM_PROMPT = `You are OpenComputer, a careful and efficient computer-use assistant running on the user's desktop.

Operating principles:
- Follow the user's latest request exactly. Do not expand its scope, make unrelated improvements, or interact with unrelated applications.
- Prefer the smallest number of deliberate actions that can complete the request. Do not move the mouse, click, scroll, open pages, or repeat checks without a concrete reason.
- Answer informational questions directly when desktop interaction is unnecessary.
- Never repeat an action that the verification image shows has already succeeded. If the same approach fails twice, inspect more closely with view_region or ask the user instead of looping.
- Do not bundle actions when a later action depends on the visual result of an earlier one. Observe the returned verification frame first.
- Treat approval for one action as approval only for that action, never as permission to broaden the task.

Desktop operation:
- A fresh screenshot of the primary desktop is automatically attached to every new request. Inspect it before the first action; do not call view_screen immediately unless the desktop changed or a new full frame is genuinely needed.
- Every returned screen image is represented as a normalized 1000x1000 coordinate grid, regardless of its actual pixel dimensions.
- Use normalized x/y values from 0 through 1000 relative to the most recent returned image: top-left=(0,0), center=(500,500), bottom-right=(1000,1000). Aim at the visual center of the intended control.
- A small OpenComputer "Observing" capsule may appear at the top-right of screenshots. Ignore it; it is the assistant's capture indicator, not part of the target application.
- Use view_region to zoom into a small, crowded, or ambiguous target before clicking it. The region bounds and subsequent mouse coordinates are relative to the most recent returned image.
- Mouse and keyboard actions return a fresh verification screenshot. Inspect it before continuing and do not reuse old coordinates after the UI or returned image changes.
- Older conversation and completed tool rounds may be represented by compact text memory. Use it for continuity, but treat the newest request, latest tool results, and current screenshot as authoritative.
- Never claim an action succeeded unless the tool result or verification frame confirms it. Stop promptly when the requested outcome is reached.
- Use ask_user to pause and ask one short, specific question whenever missing information could change the target or result. Do this before taking actions based on a guess.
- Research and comparison may be performed by opening the user's browser and navigating it with screen, mouse, and keyboard tools.
- Do not submit purchases, send messages, delete data, change security settings, or publish content without clear user intent. The app may separately request tool approval.
- Keep the final response short and say what was actually completed.`;

const TOOLS = [
  tool("ask_user", "Pause the task and ask the user for missing information. Use before guessing an ambiguous target, recipient, preference, or consequential choice.", {
    question: { type: "string", description: "One concise question that explains what information is needed." },
  }, ["question"]),
  tool("view_screen", "Capture the entire primary display. The returned image uses a normalized 0..1000 coordinate grid.", {}),
  tool("view_region", "Zoom into a rectangular region of the most recent returned image for more accurate inspection. The returned region becomes a fresh normalized 0..1000 grid.", {
    left: coordinate("Left edge of the region."),
    top: coordinate("Top edge of the region."),
    right: coordinate("Right edge of the region."),
    bottom: coordinate("Bottom edge of the region."),
  }, ["left", "top", "right", "bottom"]),
  tool("move_mouse", "Move or hover the pointer at normalized x/y coordinates in the most recent returned image.", {
    x: coordinate("Horizontal position."),
    y: coordinate("Vertical position."),
  }, ["x", "y"]),
  tool("left_click", "Left-click at the cursor, or at normalized x/y coordinates. Supply both x and y or neither.", {
    x: coordinate("Optional horizontal position."),
    y: coordinate("Optional vertical position."),
  }),
  tool("right_click", "Right-click at the cursor, or at normalized x/y coordinates. Supply both x and y or neither.", {
    x: coordinate("Optional horizontal position."),
    y: coordinate("Optional vertical position."),
  }),
  tool("middle_click", "Middle-click at the cursor, or at normalized x/y coordinates. Supply both x and y or neither.", {
    x: coordinate("Optional horizontal position."),
    y: coordinate("Optional vertical position."),
  }),
  tool("double_click", "Double left-click at the cursor, or at normalized x/y coordinates. Supply both x and y or neither.", {
    x: coordinate("Optional horizontal position."),
    y: coordinate("Optional vertical position."),
  }),
  tool("drag", "Drag from one normalized position to another in the most recent returned image.", {
    startX: coordinate("Horizontal drag start."),
    startY: coordinate("Vertical drag start."),
    endX: coordinate("Horizontal drag end."),
    endY: coordinate("Vertical drag end."),
  }, ["startX", "startY", "endX", "endY"]),
  tool("scroll", "Scroll vertically or horizontally, optionally after moving to normalized x/y coordinates. Supply both x and y or neither.", {
    direction: { type: "string", enum: ["up", "down", "left", "right"] },
    amount: { type: "number", minimum: 1, maximum: 20, description: "Number of scroll steps." },
    x: coordinate("Optional horizontal position to scroll over."),
    y: coordinate("Optional vertical position to scroll over."),
  }, ["direction", "amount"]),
  tool("type_text", "Type literal text into the currently focused application.", {
    text: { type: "string" },
  }, ["text"]),
  tool("press_key", "Press a key, optionally with modifier keys.", {
    key: { type: "string", description: "Examples: enter, tab, escape, a, 1" },
    modifiers: { type: "array", items: { type: "string" }, description: "Examples: control, shift, alt, command" },
  }, ["key"]),
  tool("open_url", "Open an http or https URL in the default web browser.", {
    url: { type: "string" },
  }, ["url"]),
  tool("wait", "Wait briefly for an application or page to update.", {
    milliseconds: { type: "number", minimum: 50, maximum: 10000 },
  }, ["milliseconds"]),
];

export class ModelClient {
  constructor(private readonly automation: DesktopAutomation) {}

  async chat(history: ChatMessage[], settings: AppSettings, signal: AbortSignal): Promise<ChatMessage> {
    const conversation = compactChatHistory(history).map((message) => ({ ...message }) as ModelMessage);
    const baseMessages: ModelMessage[] = [{ role: "system", content: SYSTEM_PROMPT }, ...conversation];
    const actionLedger: string[] = [];
    const initialScreen = await this.automation.execute({
      id: randomUUID(),
      function: { name: "view_screen", arguments: "{}" },
    }, false, signal);
    let messages = [...baseMessages, desktopImageMessage(
      "This is the automatically captured desktop at the start of the current request. Use it as the current normalized 1000x1000 coordinate frame.",
      initialScreen,
    )];

    for (let step = 0; step <= settings.maxToolSteps; step += 1) {
      signal.throwIfAborted();
      const assistant = await this.complete(messages, settings, signal);
      if (!assistant.tool_calls?.length) {
        const content = typeof assistant.content === "string" ? assistant.content.trim() : "";
        return {
          id: randomUUID(),
          role: "assistant",
          content: content || "I finished without a text response.",
          createdAt: Date.now(),
        };
      }
      const questionCall = assistant.tool_calls.find((call) => call.function.name === "ask_user");
      if (questionCall) {
        return {
          id: randomUUID(),
          role: "assistant",
          content: questionFrom(questionCall.function.arguments),
          createdAt: Date.now(),
        };
      }
      if (step === settings.maxToolSteps) throw new Error("The action reached the configured tool-step limit.");

      let latestScreenshot: string | undefined;
      const toolMessages: ModelMessage[] = [];
      const roundLedger: string[] = [];
      for (const call of assistant.tool_calls) {
        signal.throwIfAborted();
        try {
          const result = await this.automation.execute(call, settings.permissionMode === "ask", signal);
          toolMessages.push({ role: "tool", tool_call_id: call.id, content: result.text });
          roundLedger.push(`${call.function.name}: ${result.text}`);
          if (result.imageDataUrl) latestScreenshot = result.imageDataUrl;
        } catch (error) {
          const text = `Tool error: ${errorMessage(error)}`;
          toolMessages.push({ role: "tool", tool_call_id: call.id, content: text });
          roundLedger.push(`${call.function.name}: ${text}`);
        }
      }
      messages = [...baseMessages];
      const compactProgress = compactActionLedger(actionLedger);
      if (compactProgress) {
        messages.push({
          role: "user",
          content: `Completed action ledger (older screenshots and tool messages were discarded to save context):\n${compactProgress}`,
        });
      }
      messages.push(assistant, ...toolMessages);
      if (latestScreenshot) {
        messages.push(desktopImageMessage(
          "Here is the freshest desktop image returned by the latest tool. It is the current normalized 1000x1000 coordinate frame.",
          { text: "", imageDataUrl: latestScreenshot },
        ));
      }
      actionLedger.push(...roundLedger);
    }
    throw new Error("The model did not produce a final response.");
  }

  private async complete(messages: ModelMessage[], settings: AppSettings, signal: AbortSignal): Promise<ModelMessage> {
    let response: Response;
    try {
      response = await fetch(chatCompletionsUrl(settings.baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: settings.model,
          messages,
          tools: TOOLS,
          tool_choice: "auto",
          temperature: 0.2,
          max_tokens: 2_048,
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
      });
    } catch (error) {
      if (signal.aborted) throw new Error("Task stopped.");
      throw new Error(`Could not reach ${settings.baseUrl}. Start vLLM or check the endpoint. ${errorMessage(error)}`);
    }

    const raw = await response.text();
    let data: CompletionResponse;
    try {
      data = JSON.parse(raw) as CompletionResponse;
    } catch {
      throw new Error(`The model endpoint returned an invalid response (${response.status}).`);
    }
    if (!response.ok) throw new Error(data.error?.message || `Model request failed (${response.status}).`);
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error("The model endpoint returned no assistant message.");
    return message;
  }
}

function desktopImageMessage(text: string, result: { text: string; imageDataUrl?: string }): ModelMessage {
  if (!result.imageDataUrl) {
    return { role: "user", content: `${text}\nScreenshot unavailable: ${result.text}` };
  }
  return {
    role: "user",
    content: [
      { type: "text", text: result.text ? `${text}\n${result.text}` : text },
      { type: "image_url", image_url: { url: result.imageDataUrl } },
    ],
  };
}

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[] = []) {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: { type: "object", properties, required, additionalProperties: false },
    },
  };
}

function coordinate(description: string) {
  return { type: "number", minimum: 0, maximum: 1_000, description: `${description} Normalized from 0 to 1000 in the most recent returned image.` };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function questionFrom(raw: string): string {
  try {
    const value = JSON.parse(raw) as { question?: unknown };
    const question = typeof value.question === "string" ? value.question.trim() : "";
    return question || "What additional information should I use before continuing?";
  } catch {
    return "What additional information should I use before continuing?";
  }
}
