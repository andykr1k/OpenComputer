import { BrowserWindow, desktopCapturer, globalShortcut, screen as electronScreen, shell } from "electron";
import { randomUUID } from "node:crypto";
import { Button, Key, Point, getActiveWindow, keyboard, mouse } from "@nut-tree-fork/nut-js";
import type { Window as NutWindow } from "@nut-tree-fork/nut-js";
import type { ToolApprovalRequest, ToolProgress } from "../shared/contracts.js";
import { scaleCoordinate } from "../shared/coordinates.js";

export type ToolName =
  | "view_screen"
  | "view_region"
  | "move_mouse"
  | "left_click"
  | "right_click"
  | "middle_click"
  | "double_click"
  | "drag"
  | "scroll"
  | "type_text"
  | "press_key"
  | "open_url"
  | "wait";

export interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

export interface ToolResult {
  text: string;
  imageDataUrl?: string;
}

interface PendingApproval {
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
  targetWindow?: NutWindow;
}

const READ_ONLY_TOOLS = new Set<ToolName>(["view_screen", "view_region", "wait"]);

interface NormalizedRegion {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const KEY_MAP: Record<string, Key> = {
  enter: Key.Enter,
  escape: Key.Escape,
  tab: Key.Tab,
  backspace: Key.Backspace,
  delete: Key.Delete,
  space: Key.Space,
  up: Key.Up,
  down: Key.Down,
  left: Key.Left,
  right: Key.Right,
  home: Key.Home,
  end: Key.End,
  pageup: Key.PageUp,
  pagedown: Key.PageDown,
  control: Key.LeftControl,
  ctrl: Key.LeftControl,
  alt: Key.LeftAlt,
  shift: Key.LeftShift,
  meta: Key.LeftSuper,
  command: Key.LeftSuper,
};

export class ApprovalBroker {
  private readonly pending = new Map<string, PendingApproval>();
  private readonly registeredShortcuts = new Set<string>();

  constructor(private readonly window: BrowserWindow) {}

  async request(tool: string, args: Record<string, unknown>, summary: string): Promise<boolean> {
    const id = randomUUID();
    const payload: ToolApprovalRequest = { id, tool, args, summary };
    const targetWindow = await this.externalActiveWindow();
    if (this.window.isMinimized()) this.window.restore();
    this.window.showInactive();
    this.window.webContents.send("tool:approval-request", payload);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => void this.resolve(id, false), 60_000);
      this.pending.set(id, { resolve, timer, targetWindow });
      if (!this.registerApprovalShortcuts()) {
        this.window.focus();
        this.window.webContents.focus();
      }
    });
  }

  async resolve(id: string, approved: boolean): Promise<void> {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    this.unregisterApprovalShortcuts();
    if (pending.targetWindow) {
      try {
        await pending.targetWindow.focus();
        await new Promise((resolve) => setTimeout(resolve, 80));
      } catch {
        // The target application may have closed while approval was pending.
      }
    }
    pending.resolve(approved);
  }

  cancelAll(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.resolve(false);
    }
    this.pending.clear();
    this.unregisterApprovalShortcuts();
  }

  private registerApprovalShortcuts(): boolean {
    this.unregisterApprovalShortcuts();
    const shortcuts: Array<[string, boolean]> = [
      ["Enter", true],
      ["Delete", false],
      ["Backspace", false],
    ];
    for (const [accelerator, approved] of shortcuts) {
      const registered = globalShortcut.register(accelerator, () => {
        this.window.webContents.send("tool:approval-shortcut", approved);
      });
      if (!registered) {
        this.unregisterApprovalShortcuts();
        return false;
      }
      this.registeredShortcuts.add(accelerator);
    }
    return true;
  }

  private unregisterApprovalShortcuts(): void {
    for (const accelerator of this.registeredShortcuts) globalShortcut.unregister(accelerator);
    this.registeredShortcuts.clear();
  }

  private async externalActiveWindow(): Promise<NutWindow | undefined> {
    try {
      const activeWindow = await getActiveWindow();
      const title = await activeWindow.getTitle();
      return title === "OpenComputer" ? undefined : activeWindow;
    } catch {
      return undefined;
    }
  }
}

export class DesktopAutomation {
  private lastCapture?: {
    targetLeft: number;
    targetTop: number;
    targetWidth: number;
    targetHeight: number;
  };

  constructor(
    private readonly window: BrowserWindow,
    private readonly approvals: ApprovalBroker,
  ) {
    mouse.config.mouseSpeed = 1_200;
    keyboard.config.autoDelayMs = 5;
  }

  async execute(call: ToolCall, requireApproval: boolean, signal?: AbortSignal): Promise<ToolResult> {
    signal?.throwIfAborted();
    const name = call.function.name as ToolName;
    const args = parseArguments(call.function.arguments);
    const summary = summarize(name, args);
    const progress: ToolProgress = { tool: name, summary };
    this.window.webContents.send("tool:progress", progress);

    if (requireApproval && !READ_ONLY_TOOLS.has(name)) {
      const approved = await this.approvals.request(name, args, summary);
      signal?.throwIfAborted();
      if (!approved) return { text: `The user declined: ${summary}` };
    }

    const passThroughDuringAction = !READ_ONLY_TOOLS.has(name);
    if (passThroughDuringAction) this.window.setIgnoreMouseEvents(true, { forward: true });

    try {
      switch (name) {
      case "view_screen":
        return this.capturePrimaryScreen();
      case "view_region":
        return this.capturePrimaryScreen(regionFrom(args));
      case "move_mouse": {
        const { x, y } = this.coordinates(args);
        await mouse.move([new Point(x, y)]);
        return this.verifyAction(`Mouse moved to (${x}, ${y}).`, 450);
      }
      case "left_click":
        await this.optionalMove(args);
        await mouse.click(Button.LEFT);
        return this.verifyAction("Left click completed.");
      case "right_click":
        await this.optionalMove(args);
        await mouse.click(Button.RIGHT);
        return this.verifyAction("Right click completed.");
      case "middle_click":
        await this.optionalMove(args);
        await mouse.click(Button.MIDDLE);
        return this.verifyAction("Middle click completed.");
      case "double_click":
        await this.optionalMove(args);
        await mouse.doubleClick(Button.LEFT);
        return this.verifyAction("Double click completed.");
      case "drag": {
        const start = this.coordinates({ x: args.startX, y: args.startY });
        const end = this.coordinates({ x: args.endX, y: args.endY });
        await mouse.move([new Point(start.x, start.y)]);
        await mouse.drag([new Point(start.x, start.y), new Point(end.x, end.y)]);
        return this.verifyAction(`Dragged from (${start.x}, ${start.y}) to (${end.x}, ${end.y}).`, 500);
      }
      case "scroll": {
        await this.optionalMove(args);
        const amount = Math.min(20, Math.max(1, Math.round(Number(args.amount) || 3)));
        const direction = String(args.direction ?? "down");
        if (direction === "up") await mouse.scrollUp(amount);
        else if (direction === "down") await mouse.scrollDown(amount);
        else if (direction === "left") await mouse.scrollLeft(amount);
        else if (direction === "right") await mouse.scrollRight(amount);
        else throw new Error("Scroll direction must be up, down, left, or right.");
        return this.verifyAction(`Scrolled ${direction} ${amount} steps.`, 450);
      }
      case "type_text": {
        const value = String(args.text ?? "");
        if (!value) throw new Error("type_text requires non-empty text.");
        await keyboard.type(value);
        return this.verifyAction(`Typed ${value.length} characters.`);
      }
      case "press_key": {
        const key = resolveKey(String(args.key ?? ""));
        const modifiers = Array.isArray(args.modifiers)
          ? args.modifiers.map((value) => resolveKey(String(value)))
          : [];
        if (modifiers.length) await keyboard.pressKey(...modifiers);
        await keyboard.pressKey(key);
        await keyboard.releaseKey(key);
        if (modifiers.length) await keyboard.releaseKey(...modifiers.reverse());
        return this.verifyAction(`Pressed ${String(args.key)}.`);
      }
      case "open_url": {
        const url = safeUrl(String(args.url ?? ""));
        await shell.openExternal(url);
        return this.verifyAction(`Opened ${url} in the default browser.`, 1_000);
      }
      case "wait": {
        const milliseconds = Math.min(10_000, Math.max(50, Number(args.milliseconds) || 1_000));
        await abortableDelay(milliseconds, signal);
        return this.verifyAction(`Waited ${milliseconds} ms.`, 0);
      }
      default:
        throw new Error(`Unsupported tool: ${String(name)}`);
      }
    } finally {
      if (passThroughDuringAction && !this.window.isDestroyed()) this.window.setIgnoreMouseEvents(false);
    }
  }

  private async optionalMove(args: Record<string, unknown>): Promise<void> {
    if (args.x === undefined && args.y === undefined) return;
    const { x, y } = this.coordinates(args);
    await mouse.move([new Point(x, y)]);
  }

  private coordinates(args: Record<string, unknown>): { x: number; y: number } {
    if (!this.lastCapture) throw new Error("view_screen must be called before using screenshot coordinates.");
    const normalizedX = Number(args.x);
    const normalizedY = Number(args.y);
    if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
      throw new Error("Valid normalized x and y coordinates are required.");
    }
    const capture = this.lastCapture;
    if (normalizedX < 0 || normalizedY < 0 || normalizedX > 1_000 || normalizedY > 1_000) {
      throw new Error("Coordinates must be on Qwen's normalized 0..1000 grid.");
    }

    return {
      x: capture.targetLeft + scaleCoordinate(normalizedX, 1_001, capture.targetWidth),
      y: capture.targetTop + scaleCoordinate(normalizedY, 1_001, capture.targetHeight),
    };
  }

  private async verifyAction(text: string, delayMs = 300): Promise<ToolResult> {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const screenshot = await this.capturePrimaryScreen();
    return {
      text: `${text} Verification: ${screenshot.text}`,
      imageDataUrl: screenshot.imageDataUrl,
    };
  }

  private async capturePrimaryScreen(region?: NormalizedRegion): Promise<ToolResult> {
    const display = electronScreen.getPrimaryDisplay();
    const useCaptureMode = this.window.isVisible();
    if (useCaptureMode) {
      this.window.webContents.send("window:capture-mode", true);
      await new Promise((resolve) => setTimeout(resolve, 140));
    }

    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: display.size,
        fetchWindowIcons: false,
      });
      const source = sources.find((candidate) => candidate.display_id === String(display.id)) ?? sources[0];
      if (!source || source.thumbnail.isEmpty()) {
        throw new Error("No desktop image was returned. Check Screen Recording permission.");
      }
      const { width: imageWidth, height: imageHeight } = source.thumbnail.getSize();
      const displayBounds = display.bounds;
      if (imageWidth < 2 || imageHeight < 2 || displayBounds.width < 2 || displayBounds.height < 2) {
        throw new Error("Could not determine valid screenshot and automation dimensions.");
      }

      const base = region ? this.lastCapture : undefined;
      if (region && !base) throw new Error("view_screen must be called before view_region.");
      const targetLeft = region && base
        ? base.targetLeft + scaleCoordinate(region.left, 1_001, base.targetWidth)
        : displayBounds.x;
      const targetTop = region && base
        ? base.targetTop + scaleCoordinate(region.top, 1_001, base.targetHeight)
        : displayBounds.y;
      const targetRight = region && base
        ? base.targetLeft + scaleCoordinate(region.right, 1_001, base.targetWidth)
        : displayBounds.x + displayBounds.width - 1;
      const targetBottom = region && base
        ? base.targetTop + scaleCoordinate(region.bottom, 1_001, base.targetHeight)
        : displayBounds.y + displayBounds.height - 1;
      const targetWidth = targetRight - targetLeft + 1;
      const targetHeight = targetBottom - targetTop + 1;

      const imageLeft = scaleCoordinate(targetLeft - displayBounds.x, displayBounds.width, imageWidth);
      const imageTop = scaleCoordinate(targetTop - displayBounds.y, displayBounds.height, imageHeight);
      const imageRight = scaleCoordinate(targetRight - displayBounds.x, displayBounds.width, imageWidth);
      const imageBottom = scaleCoordinate(targetBottom - displayBounds.y, displayBounds.height, imageHeight);
      const image = region
        ? source.thumbnail.crop({
            x: imageLeft,
            y: imageTop,
            width: imageRight - imageLeft + 1,
            height: imageBottom - imageTop + 1,
          })
        : source.thumbnail;

      this.lastCapture = { targetLeft, targetTop, targetWidth, targetHeight };
      const { width: resultWidth, height: resultHeight } = image.getSize();
      const imageDataUrl = `data:image/jpeg;base64,${image.toJPEG(region ? 86 : 76).toString("base64")}`;
      return {
        text: `${region ? "Desktop region" : "Primary desktop"} captured at ${resultWidth}x${resultHeight}. Treat this returned image as a fresh normalized 1000x1000 grid: top-left=(0,0), center=(500,500), bottom-right=(1000,1000).`,
        imageDataUrl,
      };
    } finally {
      if (useCaptureMode && !this.window.isDestroyed()) this.window.webContents.send("window:capture-mode", false);
    }
  }
}

function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, milliseconds));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Task stopped."));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function parseArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("The model supplied invalid tool arguments.");
  }
}

function resolveKey(input: string): Key {
  const normalized = input.trim().toLowerCase();
  if (KEY_MAP[normalized]) return KEY_MAP[normalized];
  if (/^[a-z]$/.test(normalized)) return Key[normalized.toUpperCase() as keyof typeof Key];
  if (/^[0-9]$/.test(normalized)) return Key[`Num${normalized}` as keyof typeof Key];
  throw new Error(`Unsupported key: ${input}`);
}

function safeUrl(value: string): string {
  const parsed = new URL(value);
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) throw new Error("Only http and https URLs may be opened.");
  return parsed.toString();
}

function regionFrom(args: Record<string, unknown>): NormalizedRegion {
  const region = {
    left: Number(args.left),
    top: Number(args.top),
    right: Number(args.right),
    bottom: Number(args.bottom),
  };
  if (Object.values(region).some((value) => !Number.isFinite(value) || value < 0 || value > 1_000)) {
    throw new Error("Region bounds must be valid numbers on the normalized 0..1000 grid.");
  }
  if (region.right <= region.left || region.bottom <= region.top) {
    throw new Error("Region right/bottom bounds must be greater than left/top bounds.");
  }
  if (region.right - region.left < 20 || region.bottom - region.top < 20) {
    throw new Error("The viewed region must span at least 20 normalized units in each direction.");
  }
  return region;
}

function summarize(name: ToolName, args: Record<string, unknown>): string {
  switch (name) {
    case "view_screen": return "View the primary desktop";
    case "view_region": return `Zoom into screen region (${args.left}, ${args.top}) to (${args.right}, ${args.bottom})`;
    case "move_mouse": return `Move the mouse to (${args.x}, ${args.y})`;
    case "left_click": return args.x === undefined ? "Left-click at the cursor" : `Left-click at (${args.x}, ${args.y})`;
    case "right_click": return args.x === undefined ? "Right-click at the cursor" : `Right-click at (${args.x}, ${args.y})`;
    case "middle_click": return args.x === undefined ? "Middle-click at the cursor" : `Middle-click at (${args.x}, ${args.y})`;
    case "double_click": return args.x === undefined ? "Double-click at the cursor" : `Double-click at (${args.x}, ${args.y})`;
    case "drag": return `Drag from (${args.startX}, ${args.startY}) to (${args.endX}, ${args.endY})`;
    case "scroll": return `Scroll ${String(args.direction ?? "down")} ${Number(args.amount) || 3} steps`;
    case "type_text": return `Type ${String(args.text ?? "").length} characters into the focused app`;
    case "press_key": return `Press ${String(args.key ?? "a key")}`;
    case "open_url": return `Open ${String(args.url ?? "a URL")}`;
    case "wait": return `Wait ${Number(args.milliseconds) || 1_000} ms`;
  }
}
