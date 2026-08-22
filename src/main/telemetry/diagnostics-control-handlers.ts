import type { DiagnosticSummaryV1 } from '@echocue/contracts';
import type { DiagnosticsSource } from './DiagnosticsSource.js';

export interface DiagnosticsControlDeps {
  diagnostics: DiagnosticsSource;
}

export interface DiagnosticsControlHandlers {
  getSummary: () => Promise<DiagnosticSummaryV1>;
}

// Core diagnostics IPC logic. The summary is already anonymized (no comment
// text, keys, or trace ids); this boundary only forwards it.
export function createDiagnosticsControlHandlers(deps: DiagnosticsControlDeps): DiagnosticsControlHandlers {
  return {
    async getSummary() {
      return deps.diagnostics.getSummary();
    },
  };
}
