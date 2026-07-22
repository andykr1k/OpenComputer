import { BrowserWindow, screen } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const COLLAPSED = { width: 76, height: 76 };
const EXPANDED = { width: 408, height: 620 };
const MARGIN = 18;

export class AssistantWindow {
  readonly browserWindow: BrowserWindow;
  private expanded = false;

  constructor() {
    this.browserWindow = new BrowserWindow({
      ...COLLAPSED,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      show: false,
      webPreferences: {
        preload: join(currentDir, "../preload/preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    this.browserWindow.setAlwaysOnTop(true, "floating");
    this.browserWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.browserWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.browserWindow.webContents.once("did-finish-load", () => {
      this.browserWindow.webContents.on("will-navigate", (event) => event.preventDefault());
    });
    this.position(COLLAPSED);
    this.browserWindow.once("ready-to-show", () => this.browserWindow.showInactive());
  }

  async load(): Promise<void> {
    const devUrl = process.env.VITE_DEV_SERVER_URL;
    if (devUrl) {
      await this.browserWindow.loadURL(devUrl);
    } else {
      await this.browserWindow.loadFile(join(currentDir, "../../dist-renderer/index.html"));
    }
  }

  expand(): void {
    if (this.expanded) return;
    this.expanded = true;
    this.resizeAndPosition(EXPANDED);
    this.browserWindow.webContents.send("window:expanded", true);
  }

  collapse(): void {
    if (!this.expanded) return;
    this.expanded = false;
    this.resizeAndPosition(COLLAPSED);
    this.browserWindow.webContents.send("window:expanded", false);
  }

  reposition(): void {
    this.position(this.expanded ? EXPANDED : COLLAPSED);
  }

  isExpanded(): boolean {
    return this.expanded;
  }

  private resizeAndPosition(size: typeof COLLAPSED): void {
    const { x, y } = this.coordinates(size);
    this.browserWindow.setBounds({ x, y, ...size });
  }

  private position(size: typeof COLLAPSED): void {
    const { x, y } = this.coordinates(size);
    this.browserWindow.setBounds({ x, y, ...size });
  }

  private coordinates(size: typeof COLLAPSED): { x: number; y: number } {
    const workArea = screen.getPrimaryDisplay().workArea;
    return {
      x: workArea.x + workArea.width - size.width - MARGIN,
      y: workArea.y + MARGIN,
    };
  }
}
