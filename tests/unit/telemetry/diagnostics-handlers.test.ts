import { describe, it, expect } from 'vitest';
import {
  DiagnosticsSource,
  createDiagnosticsControlHandlers,
} from '../../../src/main/telemetry/index.js';

describe('Diagnostics IPC handlers', () => {
  it('getSummary returns the anonymous run summary', async () => {
    const diagnostics = new DiagnosticsSource();
    diagnostics.updateLifecycle('RUNNING', 'LISTENING');
    diagnostics.recordCommentReceived();
    diagnostics.recordSuggestion('displayed', 1800);

    const handlers = createDiagnosticsControlHandlers({ diagnostics });
    const summary = await handlers.getSummary();

    expect(summary.lifecycle).toBe('RUNNING');
    expect(summary.activity).toBe('LISTENING');
    expect(summary.lastCommentReceivedAt).toBeDefined();
    expect(summary.lastSuggestionResult).toBe('displayed');
    expect(summary.lastE2eLatencyMs).toBe(1800);
  });

  it('getSummary with no activity leaves optional fields undefined', async () => {
    const diagnostics = new DiagnosticsSource();
    const handlers = createDiagnosticsControlHandlers({ diagnostics });
    const summary = await handlers.getSummary();
    expect(summary.lastCommentReceivedAt).toBeUndefined();
    expect(summary.lastSuggestionAt).toBeUndefined();
    expect(summary.lastE2eLatencyMs).toBeUndefined();
  });

  it('summary never contains comment text, persona text, keys, or trace ids', async () => {
    const diagnostics = new DiagnosticsSource();
    diagnostics.recordCommentReceived();
    diagnostics.recordSuggestion('filtered');
    const handlers = createDiagnosticsControlHandlers({ diagnostics });
    const summary = await handlers.getSummary();
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('trace');
    expect(serialized).not.toContain('弹幕');
    expect(serialized).not.toContain('sk-');
  });

  it('a non-displayed result clears a stale e2e latency', async () => {
    const diagnostics = new DiagnosticsSource();
    diagnostics.recordSuggestion('displayed', 1800);
    diagnostics.recordSuggestion('filtered');
    const handlers = createDiagnosticsControlHandlers({ diagnostics });
    const summary = await handlers.getSummary();
    expect(summary.lastSuggestionResult).toBe('filtered');
    expect(summary.lastE2eLatencyMs).toBeUndefined();
  });
});
