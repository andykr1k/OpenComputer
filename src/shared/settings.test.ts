import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./contracts.js";
import { chatCompletionsUrl, sanitizeSettings } from "./settings.js";

describe("sanitizeSettings", () => {
  it("uses local vLLM and Qwen defaults", () => {
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("normalizes URLs and clamps tool steps", () => {
    const settings = sanitizeSettings({
      providerMode: "remote",
      baseUrl: " https://models.example/v1/// ",
      model: " custom-model ",
      apiKey: " secret ",
      permissionMode: "automatic",
      maxToolSteps: 100,
    });
    expect(settings).toEqual({
      providerMode: "remote",
      baseUrl: "https://models.example/v1",
      model: "custom-model",
      apiKey: "secret",
      permissionMode: "automatic",
      maxToolSteps: 30,
    });
  });

  it("migrates the legacy approval checkbox", () => {
    const settings = sanitizeSettings({ requireActionApproval: false } as never);
    expect(settings.permissionMode).toBe("automatic");
  });
});

describe("chatCompletionsUrl", () => {
  it("builds the OpenAI-compatible endpoint", () => {
    expect(chatCompletionsUrl("http://localhost:8000/v1/")).toBe("http://localhost:8000/v1/chat/completions");
  });
});
