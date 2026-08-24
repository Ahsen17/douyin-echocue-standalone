import type { SessionMetricsSnapshotV1 } from '@echocue/contracts';
import type { MetricsHub } from './MetricsHub.js';

export interface MonitoringControlDeps {
  metricsHub: MetricsHub;
}

export interface MonitoringControlHandlers {
  getSessionMetrics: () => SessionMetricsSnapshotV1;
}

// Monitoring IPC logic (WP-1). The snapshot is already anonymized (enum counts
// and latencies only); this boundary only forwards it.
export function createMonitoringControlHandlers(
  deps: MonitoringControlDeps,
): MonitoringControlHandlers {
  return {
    getSessionMetrics() {
      return deps.metricsHub.sessionSnapshot();
    },
  };
}
