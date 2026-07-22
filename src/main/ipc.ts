import { BrowserWindow, ipcMain } from "electron";
import type { AppSettings, ChatRequest } from "../shared/contracts.js";
import type { ApprovalBroker } from "./automation.js";
import type { ModelClient } from "./llm.js";
import type { SettingsStore } from "./store.js";
import type { AssistantWindow } from "./window.js";

export function registerIpc(
  assistantWindow: AssistantWindow,
  store: SettingsStore,
  model: ModelClient,
  approvals: ApprovalBroker,
): void {
  const trusted = (event: Electron.IpcMainInvokeEvent): boolean => event.sender === assistantWindow.browserWindow.webContents;
  let activeChat: AbortController | undefined;

  ipcMain.handle("settings:get", (event) => {
    ensureTrusted(trusted(event));
    return store.get();
  });
  ipcMain.handle("settings:set", (event, value: AppSettings) => {
    ensureTrusted(trusted(event));
    return store.set(value);
  });
  ipcMain.handle("chat:send", async (event, request: ChatRequest) => {
    ensureTrusted(trusted(event));
    if (!Array.isArray(request?.messages)) throw new Error("Invalid chat request.");
    if (activeChat) throw new Error("A task is already running.");
    const controller = new AbortController();
    activeChat = controller;
    try {
      const settings = await store.get();
      const message = await model.chat(request.messages, settings, controller.signal);
      return { message };
    } finally {
      if (activeChat === controller) activeChat = undefined;
    }
  });
  ipcMain.handle("chat:cancel", (event) => {
    ensureTrusted(trusted(event));
    if (!activeChat) return false;
    activeChat.abort("Task stopped by the user.");
    approvals.cancelAll();
    return true;
  });
  ipcMain.handle("window:expand", (event) => {
    ensureTrusted(trusted(event));
    assistantWindow.expand();
  });
  ipcMain.handle("window:collapse", (event) => {
    ensureTrusted(trusted(event));
    assistantWindow.collapse();
  });
  ipcMain.handle("window:close", (event) => {
    ensureTrusted(trusted(event));
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
  ipcMain.handle("tool:approval-response", (event, id: string, approved: boolean) => {
    ensureTrusted(trusted(event));
    approvals.resolve(String(id), approved === true);
  });
}

function ensureTrusted(value: boolean): asserts value {
  if (!value) throw new Error("Untrusted IPC sender.");
}
