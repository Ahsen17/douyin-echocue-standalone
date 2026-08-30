import type { SuggestionDisplaySink } from '../suggestion/index.js';
import { HistoryBuffer } from './history-buffer.js';
import { createHistoryController } from './history-controller.js';
import type { HistoryController } from './history-controller.js';
import { wireHistoryControl } from './history-control-ipc.js';

export { HistoryBuffer, createHistoryController, wireHistoryControl };
export type { HistoryController, HistoryWindowLike } from './history-controller.js';

// Composes the real display sink so a successfully shown suggestion is also
// appended to the history feed (the single funnel every display passes through).
// Recording happens only after the overlay's first-frame ack — a failed/ignored
// show never enters history.
export function createHistoryAwareSink(
  inner: SuggestionDisplaySink,
  history: HistoryController,
): SuggestionDisplaySink {
  return {
    async show(payload, meta) {
      const result = await inner.show(payload, meta);
      if (result.ok) history.record(payload);
      return result;
    },
    hide() {
      return inner.hide();
    },
  };
}
