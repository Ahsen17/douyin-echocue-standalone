# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Echocue is a Windows standalone desktop application (Electron + React + TypeScript) that provides real-time AI-powered suggestions for live streaming. It receives live chat messages (弹幕) from Douyin (抖音), applies safety filtering and persona routing, retrieves similar cases from Qdrant (BM25), and optionally generates suggestions via LLM (DeepSeek as first adapter). Suggestions are displayed in an always-on-top overlay window.

**Core architectural principles:**
- No agent frameworks, no multi-round tool calls, no candidate queues
- Single suggestion attempt at a time; new messages ignored during display window
- Predictable, cancellable, auditable workflow with `trace_id` for every message
- All sensitive content (messages, personas, replies, API keys) must be encrypted in audit DB or protected by safeStorage
- End-to-end P95 latency target: ≤3 seconds from WebSocket frame receipt to overlay first render

## Task Workflow (MANDATORY)

**Before starting any implementation work**, you MUST:

1. Read `.claude/rules/roadmap.md` to understand the constraint
2. Read `docs/08-delivery/Echocue-MVP里程碑与原子任务实施计划-v0.1.md` to identify the specific atomic task
3. Follow the task's "最小阅读包" (minimal reading package) - only read documents listed for that task
4. DO NOT read large volumes of documentation upfront; follow progressive disclosure

**Task constraints:**
- Only one atomic task at a time
- Each task specifies prerequisite tasks, minimal reading materials, inputs, outputs, and completion criteria
- Read only the document sections, schemas, and fixtures required for the current task
- If schema/migration/fixture conflicts with prose, stop and fix the documentation rather than choosing an interpretation
- After an atomic task finished, create a summary document (named in task ID) in `progress/` directory.

## Document Structure and Authority

Key documents (see `docs/08-delivery/...` for full mapping):
- `docs/01-requirements/` - MVP scope, business rules, constraints
- `docs/02-product/` - Product requirements (FR-01 to FR-11), user behavior
- `docs/03-research/` - Technology selection, POC templates (not actual POC evidence)
- `docs/04-architecture/` - System architecture, process boundaries, real-time workflow, security
- `docs/06-data-interface/` - **THE CONTRACT**: data models, IPC, state machines, reason codes
  - `schema/contracts-v1.ts` (Zod schemas) - authoritative for all shared types
  - `migrations/` - DDL definitions
  - `fixtures/` - contract test fixtures
- `docs/09-design/` - ER diagrams, data dictionary, encryption design
- `docs/10-ui/` - Page layouts, window behavior, state visibility, IPC permissions
- `docs/11-implementation/` - LLM prompt design, provider contracts, deployment runbook

**`archived/` is historical context only - not required reading for any task.**

## Development Commands

### Prototype (UI mockup only, no Electron integration)
```bash
cd prototype
npm install
npm run dev      # Start Vite dev server
npm run build    # Type check and build
```

The prototype is a static React + Vite app with mock data. It demonstrates UI layout, page structure, and interaction patterns but does NOT connect to Electron IPC, SQLite, Qdrant, or WebSocket.

### Main Application (not yet structured)
The `src/` directory will contain the Electron application with:
- Main process (service orchestration, WebSocket, Qdrant, SQLite, LLM provider)
- Preload scripts (IPC bridge with strict whitelisting)
- Renderer processes (main window and overlay window)
- Shared contract package (must be used by all processes; no enum duplication)

Testing structure (from M0-03):
- Unit tests: pure logic, no I/O
- Contract tests: schema validation, fixture compatibility
- Integration tests: cross-module with real SQLite/Qdrant/filesystem
- E2E tests: full Electron app with mocked external services

## Architecture Highlights

### Process Boundaries
- **Renderer (main window)**: React UI for configuration, persona editing, audit review, labeling. MUST NOT access Node APIs, filesystem, database, API keys, WebSocket, or Qdrant.
- **Renderer (overlay)**: Display validated suggestions only. No generation, retrieval, audit writes, or config changes.
- **Main process**: Service state machine, WebSocket adapter, provider orchestration, candidate evaluation, window control, IPC permission enforcement.
- **AuditStore Worker**: Exclusive SQLite owner. Handles transactions, field encryption/decryption, hash chain, audit queries. No network access. No API keys.
- **Qdrant Sidecar**: Local sparse retrieval. Only accessible via loopback. Not the source of truth for audit.

### Service State Machine
- Lifecycle: `STOPPED` → `GATE_CONNECTING` (waits for `ROOM_ONLINE`) → `RUNNING` → `STOPPED`
- Activity: `IDLE/GATE_CHECKING/LISTENING/RETRIEVING/GENERATING/DISPLAYING`
- Only accepts new messages when activity != `DISPLAYING`
- Messages received during display window are audited as `RECEIVED → NORMALIZED → DISCARDED` with reason `DISPLAY_WINDOW_ACTIVE`

### Real-time Processing Pipeline
1. Receive `WebcastChatMessage` from douyinLive WebSocket
2. Audit: `RECEIVED` + `NORMALIZED` (deduplication, hard rules, member routing)
3. If filtered: `FILTERED` + reason → audit, skip rest
4. If safe: parallel (persona version load + Qdrant TopK sparse retrieval)
5. High-confidence golden_set payload → direct display
6. Else: render LLM prompt → TextGenerationProvider single-shot JSON generation
7. Validate output → display in overlay
8. After window duration: hide overlay, clear latest window, increment `window_version`

### Data Ownership
- **SQLite `audit.sqlite`**: persona versions, audit traces, labeling, sync status (field-level AES-GCM encryption for sensitive content)
- **`settings.json`**: livestream refs, provider configs, overlay preferences (atomic write via temp + fsync + rename)
- **Electron safeStorage**: API keys isolated by `provider_id` (MUST NOT fall into SQLite/Qdrant/logs)
- **Qdrant `pre_set`**: general similar cases
- **Qdrant `golden_set`**: host-approved answers (quality score ≥85), can be used for direct suggestions

### Security and Privacy
- No弹幕, personas, replies, nicknames, API keys, Authorization headers, or `trace_id` in Prometheus/OTel
- Renderer cannot read encrypted audit fields or safeStorage credentials
- When audit write fails, service MUST stop producing new suggestions (not just log)
- All async operations must check `session_id`, `trace_id`, `window_version`, `AbortController` before acting on results

## Key Contracts

### Shared Enums and Types
All processes MUST import from `contracts-v1.ts` (or generated types). DO NOT copy string enums.

Key enums:
- `ServiceLifecycle`: `STOPPED | GATE_CONNECTING | RUNNING`
- `ServiceActivity`: `IDLE | GATE_CHECKING | LISTENING | RETRIEVING | GENERATING | DISPLAYING`
- `TraceState`: 19 states from `RECEIVED` to `FAILED`
- `TraceFinalState`: `FILTERED | DISCARDED | FAILED | HIDDEN`
- `SemanticTypeV1`: message classification (persona_relevant, positive_praise, funny_joke, etc.)
- `SafetyReasonCodeV1`: why a message was blocked
- `TraceReasonCodeV1`: detailed audit reason for each transition

### Persona Routing and Versioning
- Personas stored in SQLite with natural language Markdown content
- Editing creates `draft`; explicit "Publish" generates immutable `persona_version` (UUID + SHA-256 hash)
- Atomic switch to new `active_version`
- Live service uses snapshot loaded at service start time; new persona versions require service restart
- Member name matching: exact → controlled fuzzy (high threshold, unique match only) → default to principal streamer

### Feedback Loop and Golden Set
- Audit page is the ONLY production entry point for `golden_set`
- Quality score (0-100, subjective host preference) ≠ retrieval confidence (0.00-1.00, similarity measure)
- Quality ≥85 → auto-insert into `golden_set`
- Quality 0 + corrected answer → corrected answer inserted with default quality 85
- Golden set points are versioned: bound to `persona_id` + `persona_version`

## Common Patterns

### IPC Permission Model
Renderer requests MUST go through preload whitelist. Main process validates and rate-limits. Sensitive operations (start service, edit persona, label feedback) require explicit user action in UI, not programmatic triggers.

### Cancellation and Freshness
Every `SuggestionAttempt` has `session_id`, `trace_id`, `window_version`, `AbortController`. On user stop, stream end, WebSocket disconnect, window version change, or timeout:
1. Call `abort()`
2. Any async return MUST re-check all four values
3. Mismatch → audit as `DISCARDED` with appropriate reason, do not display

### Logging and Observability
- Logs/metrics MUST be anonymized: no message content, no persona text, no API keys, no `trace_id`
- Use semantic categories, state transitions, latency percentiles, error types
- Exporter can be disabled in settings
- Audit DB is the source of truth for detailed trace replay

## Prototype Reuse Boundary

`prototype/` provides:
- Page structure and navigation (7 main entries: Run, LiveStream/AI, Persona, Preferences, Diagnostics, Audit, Labeling)
- Layout and visual design (from `docs/10-ui/...`)
- Mock state transitions and error handling
- React component patterns

Real renderer MUST:
- Replace mock data with IPC calls via preload
- Remove Node/filesystem/network access from renderer context
- Use `contracts-v1.ts` types for all IPC payloads
- Honor UI permission model: no API keys, no raw audit content, no direct DB/Qdrant access

## Windows Deployment

- Target: Windows x64 standalone
- Qdrant binary runs as local sidecar (127.0.0.1 only)
- douyinLive WebSocket client (local WebSocket connection only created after user starts AI service)
- SQLite with WAL mode, field-level AES-GCM encryption
- API keys protected by Electron safeStorage + DPAPI
- Installation manifest, license scan, SBOM required (no runtime binary downloads)

## Testing Strategy

From `docs/08-delivery/Echocue-研发任务拆分、测试计划与验收标准-v0.1.md`:
- T-PKG-* : Package and build tests
- T-PROV-* : Provider contract and credential tests
- T-AUD-* : Audit storage, encryption, hash chain tests
- T-STO-* : SQLite migration and transaction tests
- T-SAFE-* : Safety rule and routing tests
- T-QRY-* : Qdrant retrieval and BM25 tests
- T-IPC-* : IPC permission and data masking tests
- T-OVR-* : Overlay window behavior tests
- T-DIAG-* : Diagnostic data anonymization tests

All tests must cover: normal path, boundary cases, failure cases, permission violations.

## Language and Documentation

All design documents are in Chinese. Code comments should be minimal (only non-obvious WHY, not WHAT). Variable/function names in English. Commit messages and PR descriptions in Chinese for this project.
