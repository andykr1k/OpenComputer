import { contextBridge, ipcRenderer } from "electron";
import type {
  AppSettings,
  ChatRequest,
  ChatResponse,
  DesktopBridge,
  ToolApprovalRequest,
  ToolProgress,
} from "../shared/contracts.js";

const bridge: DesktopBridge = {
  getSettings: () => ipcRenderer.invoke("settings:get") as Promise<AppSettings>,
  saveSettings: (settings) => ipcRenderer.invoke("settings:set", settings) as Promise<AppSettings>,
  chat: (request: ChatRequest) => ipcRenderer.invoke("chat:send", request) as Promise<ChatResponse>,
  cancelChat: () => ipcRenderer.invoke("chat:cancel") as Promise<boolean>,
  expand: (pinned = false) => ipcRenderer.invoke("window:expand", pinned) as Promise<void>,
  collapse: () => ipcRenderer.invoke("window:collapse") as Promise<void>,
  close: () => ipcRenderer.invoke("window:close") as Promise<void>,
  approveTool: (id, approved) => ipcRenderer.invoke("tool:approval-response", id, approved) as Promise<void>,
  onApprovalRequest: (listener) => subscribe("tool:approval-request", listener),
  onToolProgress: (listener) => subscribe("tool:progress", listener),
  onCaptureMode: (listener) => subscribe("window:capture-mode", listener),
  onApprovalShortcut: (listener) => subscribe("tool:approval-shortcut", listener),
};

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld("openComputer", bridge);
