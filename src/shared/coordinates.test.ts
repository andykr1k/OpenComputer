import { describe, expect, it } from "vitest";
import { scaleCoordinate } from "./coordinates.js";

describe("scaleCoordinate", () => {
  it("maps screenshot edges exactly to automation-screen edges", () => {
    expect(scaleCoordinate(0, 1280, 1920)).toBe(0);
    expect(scaleCoordinate(1279, 1280, 1920)).toBe(1919);
  });

  it("scales interior pixels instead of assuming matching display sizes", () => {
    expect(scaleCoordinate(640, 1280, 1920)).toBe(960);
    expect(scaleCoordinate(360, 720, 1080)).toBe(540);
  });

  it("maps Qwen's normalized 1000x1000 coordinate grid to the display", () => {
    expect(scaleCoordinate(0, 1_001, 1920)).toBe(0);
    expect(scaleCoordinate(500, 1_001, 1920)).toBe(960);
    expect(scaleCoordinate(1_000, 1_001, 1920)).toBe(1919);
  });
});
