import { HistoryBuffer } from './history-buffer.js';
import { createHistoryController } from './history-controller.js';
import type { HistoryController } from './history-controller.js';
import { wireHistoryControl } from './history-control-ipc.js';

export { HistoryBuffer, createHistoryController, wireHistoryControl };
export type { HistoryController, HistoryWindowLike } from './history-controller.js';
