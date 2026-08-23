# Echocue

[![Electron](https://img.shields.io/badge/Electron-35-47848F.svg)](https://www.electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF.svg)](https://vitejs.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-22-339933.svg)](https://nodejs.org/)
[![Vitest](https://img.shields.io/badge/testing-Vitest-6E9F18.svg)](https://vitest.dev/)
[![License](https://img.shields.io/badge/license-Apache--2.0-green.svg)](LICENCE)

English | [简体中文](README_zh.md)

Echocue is a Windows standalone desktop application for Douyin (抖音) live-stream hosts and operations teams.
It turns live chat (弹幕) into faster, persona-consistent reply suggestions in real time — from the WebSocket
frame arriving to a suggestion rendering in an always-on-top overlay, **targeting** P95 latency under 3 seconds.

Every message flows through a single, auditable pipeline: safety filtering → persona routing → Qdrant (BM25)
retrieval → optional LLM generation → overlay display. One suggestion attempt at a time; new messages received
while a suggestion is showing are discarded, not queued.

## Typical Scenarios

- A host wants quick, natural reply suggestions during a busy live room without tabbing away.
- A team wants responses to stay consistent with each member's persona and the room's tone.
- An operator wants a structured, traceable way to assist live interaction — including review and labeling.

## MVP Roadmap

- [x] M0 Foundation — Electron + Vite + React + TypeScript baseline, shared Zod contract package, layered test harness, locked dependencies and license/SBOM.
- [x] M1 Local infrastructure — `settings.json` repo, safeStorage credentials, AES-GCM/HMAC/DPAPI crypto, SQLite audit worker, main-window/tray shell, anonymized telemetry.
- [x] M2 Persona, safety and routing — member/alias CRUD, persona draft/publish/rollback, safety rule compiler, comment normalization and member routing.
- [x] M3 Qdrant and BM25 — bundled Qdrant sidecar, jieba-BM25 pipeline, and dual `pre_set` / `golden_set` retrieval with calibration and rerank.
- [x] M4 douyinLive ingestion and state machine — bundled douyinLive sidecar, local WebSocket adapter, lifecycle/activity state machine.
- [x] M5 Provider and orchestration — provider config/connection test, stable `TextGenerationProvider`, DeepSeek and OpenAI-compatible adapters, deterministic prompt assembly, and real-time `SuggestionAttempt` orchestration.
- [x] M6 Renderer and overlay — seven formal UI entries and the standalone always-on-top overlay window.
- [x] M7 Feedback and release — `golden_set` feedback loop, integration/E2E acceptance, and Windows packaging/sign-off.

### High-level architecture

| Area | Role |
| --- | --- |
| `douyin` | Manages the bundled douyinLive sidecar and translates local WebSocket events into `SourceComment` events. |
| `safety` | Normalizes 弹幕, applies input safety rules (risk / PII / taboo), and filters before retrieval or model calls. |
| `persona` | Team members, names and aliases; persona drafts, publish, comparison and rollback; version-bound member routing. |
| `retrieval` | Bundled Qdrant sidecar, jieba-BM25 pipeline, and dual `pre_set` / `golden_set` query adapter with calibration and cross-collection rerank. |
| `provider` | Stable `TextGenerationProvider` interface with DeepSeek and OpenAI-compatible adapters. |
| `prompt` | Deterministic `PromptAssembler` — fixed message layout, injection isolation, versioned templates and deterministic truncation. |
| `service` | `ServiceStateMachine` (lifecycle / activity) and single-attempt `SuggestionAttempt` orchestration with full trace audit. |
| `storage` | SQLite `AuditStoreWorker` single-writer model with field-level AES-GCM encryption and a hash chain. |
| `telemetry` | Anonymized Prometheus / OpenTelemetry metrics, logs and diagnostics — no message content, persona text, API keys or `trace_id`. |
| `windows` | Main window (three buttons + tray) and the always-on-top overlay window. |

## Requirements

- Windows x64 is the target platform; Linux is used for development and CI.
- Node.js 22+
- npm
- The douyinLive and Qdrant binaries ship inside `assets/` — there are no runtime binary downloads.

## Quick Start

Install dependencies:

```bash
npm install
```

Run the app in development mode (watch-builds the main process and preload, starts the renderer dev server):

```bash
npm run dev
```

Or build and launch a production build of the Electron app:

```bash
npm run preview
```

Verify the build and the test suite:

```bash
npm run typecheck
npm run test:contracts
npm test
```

### UI prototype (static, no Electron integration)

```bash
cd prototype
npm install
npm run dev
```

The prototype demonstrates page layout and interaction patterns with mock data only.

## Common Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Watch-build main/preload and start the renderer dev server |
| `npm run build` | Production build for main, preload and renderer |
| `npm run start` | Launch Electron from the built output |
| `npm run preview` | `build` + `start` |
| `npm run typecheck` | Type-check the main process and node configs (`tsc --noEmit`) |
| `npm test` | Run the full Vitest suite |
| `npm run test:unit` | Unit tests (pure logic) |
| `npm run test:contract` | Contract-layer tests |
| `npm run test:contracts` | Shared contract schema + fixture tests |
| `npm run test:integration` | Integration tests (SQLite / Qdrant / filesystem) |
| `npm run test:e2e` | E2E tests with mocked external services |
| `npm run test:coverage` | Tests with coverage reports |
| `npm run benchmark:safety-routing` | Safety/routing benchmark against versioned samples |
| `npm run license:check` | Dependency license policy check |
| `npm run sbom` | Generate a CycloneDX SBOM |
| `npm run compliance` | `license:check` + `sbom` |

## CI

GitHub Actions (`.github/workflows/test-windows.yml`) runs on Windows for every push/PR to `master` and `develop`:
contract, unit, contract-layer, integration and E2E tests, `typecheck`, license check and SBOM generation, then
uploads the compliance artifacts.

## Repository Structure

```
src/contracts/   Shared Zod contract package — authoritative types for all processes
src/main/        Electron main process (config, crypto, storage, safety, persona, retrieval, provider, service, windows, telemetry)
src/preload/     Preload scripts (strict IPC whitelist)
src/renderer/    React renderers (main window + overlay)
tests/           Unit / contract / integration / E2E test suites
docs/            Requirements, product, architecture, data contracts, design and implementation docs
prototype/       Static React UI prototype (mock data only)
assets/          Bundled sidecar binaries (douyinLive, Qdrant)
```

## Documentation

The authoritative project docs live in `docs/` and cover requirements (`01-requirements`), product (`02-product`),
research (`03-research`), architecture (`04-architecture`), data contracts (`06-data-interface`), review (`07-review`),
delivery/roadmap (`08-delivery`), design (`09-design`), UI (`10-ui`) and implementation (`11-implementation`).
The machine-readable Zod schemas in `docs/06-data-interface/schema/contracts-v1.ts` are the source of truth for all
shared types.

## License

This project is licensed under the [Apache License 2.0](LICENSE).

---

**Off-topic Notes**

1. All requirement analysis, design, MVP, milestone, and other documents (see docs/) have been fully committed to GitHub without any omissions, for fellow enthusiasts to reference and learn from.
2. The project was built entirely using Vibe Coding, with almost no code review on my part. All subtask progress documents are also fully committed (see progress/), making it easier for future Coding Harness exchanges and reference.
3. UI prototypes are located in the prototype/ directory. The actual product UI differs significantly from the initial design, so treat them as reference only.
4. The EXE is straightforward to use — just try it out. I didn't write a separate user guide for it.
5. This project is derived from Douyin-EchoCue, which has been ARCHIVED. See that project's Issues for details.

**Special thanks to:**

[douyinLive](https://github.com/Ahsen17/douyinLive)

@[jwwsjlm](https://github.com/jwwsjlm)
