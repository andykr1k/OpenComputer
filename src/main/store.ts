import { app } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AppSettings, DEFAULT_SETTINGS } from "../shared/contracts.js";
import { sanitizeSettings } from "../shared/settings.js";

export class SettingsStore {
  private readonly filePath: string;

  constructor(filePath = join(app.getPath("userData"), "settings.json")) {
    this.filePath = filePath;
  }

  async get(): Promise<AppSettings> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return sanitizeSettings(JSON.parse(raw) as Partial<AppSettings>);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      return { ...DEFAULT_SETTINGS };
    }
  }

  async set(value: AppSettings): Promise<AppSettings> {
    const settings = sanitizeSettings(value);
    const tempPath = `${this.filePath}.tmp`;
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(tempPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
    await rename(tempPath, this.filePath);
    return settings;
  }
}
