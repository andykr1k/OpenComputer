import { AppSettings, DEFAULT_SETTINGS } from "./contracts.js";

export function sanitizeSettings(value: Partial<AppSettings> | null | undefined): AppSettings {
  const legacy = value as (Partial<AppSettings> & { requireActionApproval?: boolean }) | null | undefined;
  const baseUrl = cleanUrl(value?.baseUrl ?? DEFAULT_SETTINGS.baseUrl);
  const model = String(value?.model ?? DEFAULT_SETTINGS.model).trim() || DEFAULT_SETTINGS.model;
  const maxToolSteps = Math.min(30, Math.max(1, Math.round(Number(value?.maxToolSteps) || DEFAULT_SETTINGS.maxToolSteps)));
  const permissionMode = value?.permissionMode === "automatic"
    ? "automatic"
    : value?.permissionMode === "ask"
      ? "ask"
      : legacy?.requireActionApproval === false
        ? "automatic"
        : "ask";

  return {
    providerMode: value?.providerMode === "remote" ? "remote" : "local",
    baseUrl,
    model,
    apiKey: String(value?.apiKey ?? "").trim(),
    permissionMode,
    maxToolSteps,
  };
}

export function chatCompletionsUrl(baseUrl: string): string {
  return `${cleanUrl(baseUrl)}/chat/completions`;
}

function cleanUrl(input: string): string {
  const trimmed = String(input).trim().replace(/\/+$/, "");
  return trimmed || DEFAULT_SETTINGS.baseUrl;
}
