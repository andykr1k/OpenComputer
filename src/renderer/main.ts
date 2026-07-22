import type { AppSettings, ChatMessage, DesktopBridge, ToolApprovalRequest } from "../shared/contracts.js";

declare global {
  interface Window { openComputer: DesktopBridge }
}

const app = element<HTMLElement>("app");
const orb = element<HTMLButtonElement>("orb");
const panel = element<HTMLElement>("panel");
const messagesElement = element<HTMLElement>("messages");
const prompt = element<HTMLTextAreaElement>("prompt");
const composer = element<HTMLFormElement>("composer");
const sendButton = element<HTMLButtonElement>("send-button");
const activity = element<HTMLElement>("activity");
const status = element<HTMLElement>("status");
const chatView = element<HTMLElement>("chat-view");
const settingsView = element<HTMLElement>("settings-view");
const approval = element<HTMLElement>("approval");
let expanded = false;
let busy = false;
let stopping = false;
let stopRequested = false;
let pendingApproval: ToolApprovalRequest | null = null;
let approvalTimer: ReturnType<typeof setTimeout> | undefined;
const history: ChatMessage[] = [];

orb.addEventListener("click", async () => {
  await expand();
  prompt.focus();
});

element("collapse-button").addEventListener("click", () => {
  void collapse();
});

element("settings-button").addEventListener("click", () => void showSettings());
element("settings-back").addEventListener("click", showChat);

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  if (busy) void stopTask();
  else void sendMessage();
});

prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !busy) {
    event.preventDefault();
    composer.requestSubmit();
  }
});

prompt.addEventListener("input", resizePrompt);

element<HTMLFormElement>("settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void saveSettings();
});

bindPermissionControl("quick-permission", (mode) => void saveQuickPermission(mode));
bindPermissionControl("settings-permission", () => undefined);

element("deny-action").addEventListener("click", () => void resolveApproval(false));
element("allow-action").addEventListener("click", () => void resolveApproval(true));
element("stop-approval").addEventListener("click", () => void stopTask());

document.addEventListener("keydown", (event) => {
  if (!pendingApproval || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.key !== "Enter" && event.key !== "Delete" && event.key !== "Backspace") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void resolveApproval(event.key === "Enter");
}, true);

window.openComputer.onApprovalRequest((request) => {
  clearTimeout(approvalTimer);
  pendingApproval = request;
  element("approval-summary").textContent = request.summary;
  approval.classList.remove("hidden");
  approvalTimer = setTimeout(() => void resolveApproval(false), 60_000);
});

window.openComputer.onToolProgress((progress) => {
  if (!stopping) activity.querySelector("p")!.textContent = progress.summary;
});

window.openComputer.onCaptureMode((active) => {
  app.classList.toggle("capture-mode", active);
});

window.openComputer.onApprovalShortcut((approved) => {
  if (pendingApproval) void resolveApproval(approved);
});

void updateStatus();

async function expand(): Promise<void> {
  if (expanded) return;
  expanded = true;
  app.classList.add("resizing-window");
  await afterPaint();
  await window.openComputer.expand(true);
  panel.hidden = false;
  await afterPaint();
  app.classList.remove("collapsed");
  app.classList.add("expanded");
  app.classList.remove("resizing-window");
}

async function collapse(): Promise<void> {
  if (!expanded) return;
  expanded = false;
  showChat();
  app.classList.add("resizing-window");
  app.classList.add("collapsed");
  app.classList.remove("expanded");
  await new Promise((resolve) => setTimeout(resolve, 150));
  if (expanded) {
    app.classList.remove("resizing-window");
    return;
  }
  panel.hidden = true;
  await window.openComputer.collapse();
  app.classList.remove("resizing-window");
}

async function sendMessage(): Promise<void> {
  const content = prompt.value.trim();
  if (!content || busy) return;
  const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content, createdAt: Date.now() };
  history.push(userMessage);
  renderMessage(userMessage);
  prompt.value = "";
  resizePrompt();
  stopRequested = false;
  setBusy(true, "Thinking");

  try {
    const response = await window.openComputer.chat({ messages: history });
    if (stopRequested) renderStoppedMessage();
    else {
      history.push(response.message);
      renderMessage(response.message);
    }
  } catch (error) {
    if (stopRequested) renderStoppedMessage();
    else renderError(readError(error));
  } finally {
    setBusy(false);
    prompt.focus();
  }
}

async function stopTask(): Promise<void> {
  if (!busy || stopping) return;
  stopping = true;
  stopRequested = true;
  sendButton.disabled = true;
  activity.querySelector("p")!.textContent = "Stopping task";
  dismissApproval();
  try {
    const cancelled = await window.openComputer.cancelChat();
    if (!cancelled) stopRequested = false;
  } catch (error) {
    stopRequested = false;
    renderError(readError(error));
  } finally {
    if (busy && !stopRequested) {
      stopping = false;
      sendButton.disabled = false;
      activity.querySelector("p")!.textContent = "Finishing";
    }
  }
}

function renderStoppedMessage(): void {
  const message: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: "Task stopped. Add anything you want me to change, then send again.",
    createdAt: Date.now(),
  };
  history.push(message);
  renderMessage(message, "stopped");
}

function renderMessage(message: ChatMessage, variant?: "stopped"): void {
  const article = document.createElement("article");
  article.className = `message ${message.role}${variant ? ` ${variant}` : ""}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  const content = document.createElement("p");
  content.textContent = message.content;
  if (message.role === "assistant") {
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.append(document.createElement("span"));
    article.append(avatar);
  }
  bubble.append(content);
  article.append(bubble);
  messagesElement.append(article);
  messagesElement.scrollTop = messagesElement.scrollHeight;
}

function renderError(message: string): void {
  const article = document.createElement("article");
  article.className = "message error";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  const title = document.createElement("strong");
  title.textContent = "Connection issue";
  const content = document.createElement("p");
  content.textContent = message;
  bubble.append(title, content);
  article.append(bubble);
  messagesElement.append(article);
  messagesElement.scrollTop = messagesElement.scrollHeight;
}

function setBusy(value: boolean, label = "Thinking"): void {
  busy = value;
  stopping = false;
  sendButton.disabled = false;
  sendButton.classList.toggle("is-stop", value);
  sendButton.setAttribute("aria-label", value ? "Stop task" : "Send message");
  sendButton.title = value ? "Stop task" : "Send message";
  composer.classList.toggle("is-running", value);
  prompt.placeholder = value ? "Type more context while this runs…" : "Ask OpenComputer…";
  element("composer-hint").textContent = value
    ? "Type a follow-up · stop the task when you’re ready"
    : "Enter to send · Shift+Enter for a new line";
  setPermissionDisabled("quick-permission", value);
  element<HTMLButtonElement>("settings-button").disabled = value;
  activity.querySelector("p")!.textContent = label;
  activity.classList.toggle("hidden", !value);
}

async function showSettings(): Promise<void> {
  const settings = await window.openComputer.getSettings();
  fillSettings(settings);
  chatView.classList.add("hidden");
  settingsView.classList.remove("hidden");
}

function showChat(): void {
  settingsView.classList.add("hidden");
  chatView.classList.remove("hidden");
}

function fillSettings(settings: AppSettings): void {
  valueOf<HTMLSelectElement>("provider-mode", settings.providerMode);
  valueOf<HTMLInputElement>("base-url", settings.baseUrl);
  valueOf<HTMLInputElement>("model", settings.model);
  valueOf<HTMLInputElement>("api-key", settings.apiKey);
  setPermissionControl("settings-permission", settings.permissionMode);
  setPermissionControl("quick-permission", settings.permissionMode);
  valueOf<HTMLInputElement>("max-tool-steps", String(settings.maxToolSteps));
  updatePermissionCopy(settings.permissionMode);
  updateStatus(settings);
}

async function saveQuickPermission(mode: AppSettings["permissionMode"]): Promise<void> {
  setPermissionDisabled("quick-permission", true);
  try {
    const current = await window.openComputer.getSettings();
    const saved = await window.openComputer.saveSettings({
      ...current,
      permissionMode: mode,
    });
    fillSettings(saved);
  } catch (error) {
    renderError(readError(error));
  } finally {
    setPermissionDisabled("quick-permission", busy);
  }
}

async function saveSettings(): Promise<void> {
  const result = element("settings-result");
  result.textContent = "Saving…";
  try {
    const saved = await window.openComputer.saveSettings({
      providerMode: element<HTMLSelectElement>("provider-mode").value === "remote" ? "remote" : "local",
      baseUrl: element<HTMLInputElement>("base-url").value,
      model: element<HTMLInputElement>("model").value,
      apiKey: element<HTMLInputElement>("api-key").value,
      permissionMode: selectedPermission("settings-permission"),
      maxToolSteps: Number(element<HTMLInputElement>("max-tool-steps").value),
    });
    fillSettings(saved);
    result.textContent = "Saved";
    setTimeout(() => { result.textContent = ""; }, 1_500);
  } catch (error) {
    result.textContent = readError(error);
  }
}

async function updateStatus(settings?: AppSettings): Promise<void> {
  const current = settings ?? await window.openComputer.getSettings();
  status.innerHTML = "";
  status.append(document.createElement("i"), document.createTextNode(current.providerMode === "local" ? " Local" : " Remote"));
  status.title = `${current.model} · ${current.baseUrl}`;
  setPermissionControl("quick-permission", current.permissionMode);
  updatePermissionCopy(current.permissionMode);
}

function updatePermissionCopy(mode: AppSettings["permissionMode"]): void {
  element("intro-detail").textContent = mode === "automatic"
    ? "Automatic control is on. I’ll still ask when details are unclear."
    : "I’ll ask before controlling your desktop.";
}

async function resolveApproval(approved: boolean): Promise<void> {
  if (!pendingApproval) return;
  clearTimeout(approvalTimer);
  const current = pendingApproval;
  pendingApproval = null;
  approval.classList.add("hidden");
  await window.openComputer.approveTool(current.id, approved);
}

function dismissApproval(): void {
  clearTimeout(approvalTimer);
  pendingApproval = null;
  approval.classList.add("hidden");
}

function bindPermissionControl(id: string, onChange: (mode: AppSettings["permissionMode"]) => void): void {
  const control = element<HTMLElement>(id);
  control.addEventListener("click", (event) => {
    if (control.getAttribute("aria-disabled") === "true") return;
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-permission]");
    if (!button || !control.contains(button)) return;
    const mode = button.dataset.permission === "automatic" ? "automatic" : "ask";
    if (selectedPermission(id) === mode) return;
    setPermissionControl(id, mode);
    onChange(mode);
  });
}

function setPermissionControl(id: string, mode: AppSettings["permissionMode"]): void {
  const control = element<HTMLElement>(id);
  control.dataset.value = mode;
  for (const button of control.querySelectorAll<HTMLButtonElement>("button[data-permission]")) {
    const active = button.dataset.permission === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function selectedPermission(id: string): AppSettings["permissionMode"] {
  return element<HTMLElement>(id).dataset.value === "automatic" ? "automatic" : "ask";
}

function setPermissionDisabled(id: string, disabled: boolean): void {
  const control = element<HTMLElement>(id);
  control.setAttribute("aria-disabled", String(disabled));
  for (const button of control.querySelectorAll<HTMLButtonElement>("button")) button.disabled = disabled;
}

function resizePrompt(): void {
  prompt.style.height = "auto";
  prompt.style.height = `${Math.min(112, prompt.scrollHeight)}px`;
}

function afterPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function readError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error invoking remote method '[^']+': Error:\s*/, "");
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing element #${id}`);
  return value as T;
}

function valueOf<T extends HTMLInputElement | HTMLSelectElement>(id: string, value: string): void {
  element<T>(id).value = value;
}
