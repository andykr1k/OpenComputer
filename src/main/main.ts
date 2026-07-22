import { app, screen, session } from "electron";
import { ApprovalBroker, DesktopAutomation } from "./automation.js";
import { registerIpc } from "./ipc.js";
import { ModelClient } from "./llm.js";
import { SettingsStore } from "./store.js";
import { AssistantWindow } from "./window.js";

let assistantWindow: AssistantWindow | undefined;
let approvals: ApprovalBroker | undefined;

if (process.platform === "linux") app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    assistantWindow?.expand();
    assistantWindow?.browserWindow.show();
    assistantWindow?.browserWindow.focus();
  });

  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

    assistantWindow = new AssistantWindow();
    approvals = new ApprovalBroker(assistantWindow.browserWindow);
    const automation = new DesktopAutomation(assistantWindow.browserWindow, approvals);
    const store = new SettingsStore();
    const model = new ModelClient(automation);
    registerIpc(assistantWindow, store, model, approvals);
    screen.on("display-metrics-changed", () => assistantWindow?.reposition());
    screen.on("display-added", () => assistantWindow?.reposition());
    screen.on("display-removed", () => assistantWindow?.reposition());
    assistantWindow.browserWindow.on("closed", () => {
      approvals?.cancelAll();
      assistantWindow = undefined;
    });
    await assistantWindow.load();
  });
}

app.on("window-all-closed", () => app.quit());
