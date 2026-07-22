# Contributing to OpenComputer

Thank you for helping build an open, local-first computer-use agent.

## Before starting

- Search existing issues and pull requests.
- Open an issue before making a large architectural or behavior change.
- Do not include API keys, screenshots with personal information, proprietary model files, or generated build artifacts.
- Treat changes to permissions, automation, IPC, credential handling, or prompt policy as security-sensitive.

## Development setup

Requirements are Node.js 22.12+, npm 10+, and the Linux packages listed in the README when developing on Linux.

```bash
npm install
npm run dev
```

A model server is not needed for unit tests. For end-to-end testing, run an OpenAI-compatible multimodal endpoint and configure it in the app.

## Making a change

1. Fork the repository and create a focused branch.
2. Keep changes small enough to review and avoid unrelated formatting rewrites.
3. Add tests for pure logic, validation, coordinate mapping, context management, and settings behavior.
4. Update user and architecture documentation when behavior or trust boundaries change.
5. Run the verification suite:

```bash
npm run typecheck
npm test
npm run build
```

6. Smoke-test UI or automation changes on every operating system available to you. State which platforms were tested in the pull request.

## Pull requests

Pull requests should explain:

- the user-visible problem and solution;
- security and privacy consequences;
- testing performed;
- platform-specific behavior or limitations;
- screenshots or short recordings for visible UI changes, with private data removed.

Maintainers may request that large changes be split into smaller pull requests.

## Code guidelines

- Keep the renderer sandboxed and privileged work in the main process.
- Validate all data at the privileged boundary, even when TypeScript types exist.
- Prefer explicit tool schemas and narrow capabilities.
- Do not mark a tool read-only if it can alter external state.
- Preserve **Ask first** as the safe default.
- Avoid dependencies when a small, testable implementation is sufficient.
- Use clear names and comments for non-obvious security or platform behavior.

## Reporting vulnerabilities

Do not open a public issue for a vulnerability. Follow [SECURITY.md](SECURITY.md).

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
