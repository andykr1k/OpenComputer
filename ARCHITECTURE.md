# Architecture

This document describes OpenComputer's runtime boundaries, agent loop, automation design, and extension points.

## Runtime components

### Renderer

`src/renderer/` contains the transparent orb, chat panel, settings, approval UI, and system-aware theme. It runs with:

- context isolation enabled;
- Node.js integration disabled;
- the Chromium sandbox enabled;
- navigation and new-window creation denied.

The renderer can access only the narrow API exposed by `src/preload/preload.cts`.

### Preload bridge

The preload script exposes typed IPC operations defined in `src/shared/contracts.ts`. It contains no model or automation logic. Every main-process handler validates that the sender is the known assistant window.

### Main process

`src/main/` owns all privileged behavior:

- `main.ts` creates services and manages process lifecycle.
- `window.ts` owns the transparent always-on-top window and primary-display positioning.
- `ipc.ts` validates renderer requests and owns cancellable chat tasks.
- `store.ts` persists validated settings with user-only file permissions.
- `llm.ts` implements the OpenAI-compatible multimodal tool loop.
- `automation.ts` captures the desktop, maps visual coordinates, brokers approval, and performs input actions.

## Agent request lifecycle

1. The renderer sends the in-memory conversation through typed IPC.
2. The main process loads the current model and permission settings.
3. A fresh screenshot of the primary display is attached automatically.
4. Conversation history is compacted into recent verbatim messages plus bounded continuity memory.
5. The model either responds, asks a clarifying question, or calls tools.
6. Mutating tools pass through the permission broker when **Ask first** is enabled.
7. The tool executes and returns text plus a fresh verification screenshot.
8. Previous images/tool rounds become a compact action ledger; only the newest image is retained.
9. The loop ends on a final response, cancellation, clarification, error, or configured step limit.

## Visual coordinate system

Qwen computer-use coordinates are represented on a normalized `0..1000` grid. OpenComputer maps the most recently returned image into Electron's primary-display bounds and then into the native automation coordinate space.

`view_region` crops a normalized rectangle and makes the crop a new `1000 × 1000` frame. Any action screenshot resets the frame to the full primary display. This prevents stale region coordinates from leaking into later actions.

## Approval and focus handling

Screenshots and waits are read-only. Other tools require approval by default. While an approval is pending, temporary Enter/Delete/Backspace shortcuts are registered so approval does not steal focus from the target application. If the user clicks the approval card, the previously active native window is restored before automation continues.

The shortcuts are removed on approval, denial, timeout, cancellation, and window closure.

## Screenshot behavior

The assistant window briefly transitions into a small observing indicator while a screen frame is captured. Desktop actions temporarily pass mouse events through the transparent Electron window. This avoids click interception while keeping automation visible to the user.

## Cancellation

Each chat request owns an `AbortController`. Stopping a task aborts the current HTTP request, cancels pending approvals, interrupts explicit waits, and prevents further tool-loop iterations. Native mouse or keyboard operations already in progress may finish before cancellation is observed.

## Trust boundaries

The model and all visible desktop content are untrusted. Tool-call arguments are parsed and validated in the main process. Current controls include:

- URL protocol allowlisting (`http` and `https`);
- normalized coordinate bounds;
- tool-step limits;
- approval timeouts;
- per-action approval by default;
- renderer sandboxing and sender validation;
- cancellable model requests;
- a system prompt that limits task scope and redundant actions.

These controls are defense in depth, not a complete sandbox. In Automatic mode, the model can act with the user's desktop privileges.

## Adding a tool

1. Add the name to `ToolName` in `src/main/automation.ts`.
2. Add and validate its implementation in `DesktopAutomation.execute`.
3. Decide whether it is genuinely read-only before changing `READ_ONLY_TOOLS`.
4. Add the JSON schema and concise usage guidance to `src/main/llm.ts`.
5. Add progress/approval copy and unit tests for pure validation or mapping logic.
6. Document new security consequences.

## Future boundaries

Dedicated integrations such as Discord or search should be separate typed services rather than emulated UI when reliability matters. Credentials should move to OS keychains, and high-risk integration actions should keep final-send confirmation independent from general desktop permission mode.
