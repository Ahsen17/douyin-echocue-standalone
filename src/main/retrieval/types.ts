export interface Bm25Analysis {
  readonly tokens: readonly string[];
  readonly tf: ReadonlyMap<string, number>;
  readonly docLen: number;
}
