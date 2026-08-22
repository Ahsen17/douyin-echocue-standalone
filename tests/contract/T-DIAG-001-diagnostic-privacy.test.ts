import { describe, it, expect } from 'vitest';
import { DiagnosticSummaryV1Schema } from '@echocue/contracts';
import { DiagnosticsSource } from '../../src/main/telemetry/DiagnosticsSource.js';

describe('T-DIAG-001: Diagnostic Data Privacy', () => {
  it('should not include message content in the diagnostic summary', () => {
    const diagnostics = new DiagnosticsSource();
    diagnostics.updateLifecycle('RUNNING', 'LISTENING');
    diagnostics.recordCommentReceived();
    const summary = diagnostics.getSummary();
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('主播晚上好');
    expect(serialized).not.toContain('弹幕');
    expect(serialized).not.toContain('nickname');
  });

  it('should not include persona text in the diagnostic summary', () => {
    const diagnostics = new DiagnosticsSource();
    diagnostics.recordSuggestion('displayed', 1800);
    const summary = diagnostics.getSummary();
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('人设');
    expect(serialized).not.toContain('persona');
  });

  it('should not include API keys in diagnostics', () => {
    const diagnostics = new DiagnosticsSource();
    diagnostics.recordSuggestion('failed');
    const summary = diagnostics.getSummary();
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('sk-');
    expect(serialized).not.toContain('api_key');
    expect(serialized).not.toContain('Authorization');
  });

  it('should not include trace_id in the diagnostic summary', () => {
    const diagnostics = new DiagnosticsSource();
    diagnostics.recordCommentReceived();
    diagnostics.recordSuggestion('displayed', 900);
    const summary = diagnostics.getSummary();
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('trace_id');
    expect(serialized).not.toContain('traceId');
    expect(serialized).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}/i);
  });

  it('should allow semantic categories only', () => {
    const diagnostics = new DiagnosticsSource();
    diagnostics.recordSuggestion('filtered');
    const summary = diagnostics.getSummary();
    // A result is one of the enumerated anonymous categories, never free text.
    const parsed = DiagnosticSummaryV1Schema.parse(summary);
    expect(['displayed', 'filtered', 'discarded', 'failed']).toContain(parsed.lastSuggestionResult);
  });

  it('reports storage capacity and flags storageLowSpace below threshold (M6-08)', () => {
    const diagnostics = new DiagnosticsSource({
      readStorage: () => ({ availableBytes: 512 * 1024 * 1024, totalBytes: 8 * 1024 ** 3 }),
    });
    const summary = diagnostics.getSummary();
    expect(summary.storageAvailableBytes).toBe(512 * 1024 * 1024);
    expect(summary.storageLowSpace).toBe(true);
    // Low-space must not mask a real latest domain error.
    expect(summary.lastDomainError).toBeUndefined();
    DiagnosticSummaryV1Schema.parse(summary);
  });

  it('omits storage when the capacity read is unavailable (M6-08)', () => {
    const diagnostics = new DiagnosticsSource({ readStorage: () => null });
    const summary = diagnostics.getSummary();
    expect(summary.storageAvailableBytes).toBeUndefined();
    expect(summary.storageLowSpace).toBeUndefined();
    expect(summary.lastDomainError).toBeUndefined();
  });

  it('keeps lastDomainError intact when storage is low (M6-08)', () => {
    const diagnostics = new DiagnosticsSource({
      readStorage: () => ({ availableBytes: 512 * 1024 * 1024, totalBytes: 8 * 1024 ** 3 }),
    });
    diagnostics.recordDomainError('E_PROVIDER_TIMEOUT');
    const summary = diagnostics.getSummary();
    expect(summary.lastDomainError).toBe('E_PROVIDER_TIMEOUT');
    expect(summary.storageLowSpace).toBe(true);
  });
});
