# Roadmap

OpenComputer is early alpha. Priorities may change based on testing and contributor interest.

## Near term

- Native onboarding for macOS Screen Recording/Accessibility and Linux portal limitations.
- Multi-monitor capture and coordinate mapping.
- Target-native end-to-end automation tests.
- Streaming model output and richer task progress.
- OS-keychain storage for remote API credentials.
- More reliable active-window and focus restoration across desktop environments.
- Signed Linux, Windows, and macOS release pipeline.

## Agent reliability

- Structured action traces and optional session export.
- Adaptive screenshot resizing and region selection.
- Configurable context budgets for different model limits.
- Recovery policies for repeated visual-action failures.
- Model profiles for tool parser, reasoning parser, coordinate convention, and prompt behavior.

## Integrations

- Structured web search with cited results.
- Discord integration with recipient disambiguation and final-send confirmation.
- Extensible tool/plugin interface with explicit capability manifests.
- Optional MCP client/server support.

## Product quality

- Accessibility audit and full keyboard navigation.
- Durable, user-controlled conversation history.
- Internationalization.
- Automatic updates with signed metadata.
- Crash reporting that is opt-in and strips sensitive content.

## Non-goals for now

- Unsupervised high-risk financial, security, or account-management workflows.
- Bypassing operating-system security controls.
- Bundling proprietary model weights.
