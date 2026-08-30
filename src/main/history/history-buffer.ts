import type { HistoryEntryV1 } from '@echocue/contracts';

// In-memory ring buffer for the history-window feed. Entries are kept in
// chronological order (index 0 = oldest); appending past the capacity drops the
// oldest first. The buffer lives only in main-process memory and is cleared on
// service stop / app quit — never persisted.
export class HistoryBuffer {
  private entries: HistoryEntryV1[] = [];
  private capacityValue: number;

  constructor(capacity = 20) {
    this.capacityValue = capacity;
  }

  get capacity(): number {
    return this.capacityValue;
  }

  append(entry: HistoryEntryV1): void {
    this.entries.push(entry);
    this.trimToCapacity();
  }

  snapshot(): HistoryEntryV1[] {
    return [...this.entries];
  }

  setCapacity(capacity: number): void {
    this.capacityValue = capacity;
    this.trimToCapacity();
  }

  clear(): void {
    this.entries = [];
  }

  private trimToCapacity(): void {
    const overflow = this.entries.length - this.capacityValue;
    if (overflow > 0) this.entries.splice(0, overflow);
  }
}
