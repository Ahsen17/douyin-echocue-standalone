import { ipcMain, type WebContents } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels.js';
import { createGuardedHandler } from '../ipc/guarded-handler.js';
import type { MetricsHub } from './MetricsHub.js';
import { createMonitoringControlHandlers } from './monitoring-control-handlers.js';

export interface MonitoringControlIpcOptions {
  metricsHub: MetricsHub;
  isTrustedSender: (contents: WebContents) => boolean;
}

// monitoring.getSessionMetrics from the main window only (WP-1). The snapshot is
// the anonymous per-run summary, never raw content.
export function wireMonitoringControl(options: MonitoringControlIpcOptions): void {
  const { metricsHub, isTrustedSender } = options;
  const handlers = createMonitoringControlHandlers({ metricsHub });

  ipcMain.handle(
    IpcChannel.MonitoringGetSessionMetrics,
    createGuardedHandler(isTrustedSender, () => handlers.getSessionMetrics()),
  );
}
