// Overlay comment sent time as local "HH:mm:ss". Prefers the upstream createTime
// (Unix seconds or millis); falls back to the local receipt time so the field is
// almost always present. Returns undefined only when neither parses.
export function formatOverlaySentTime(
  upstreamCreatedAt: string | undefined,
  receivedAt: string | undefined,
): string | undefined {
  const ms = numericToMillis(upstreamCreatedAt) ?? isoToMillis(receivedAt);
  if (ms === undefined) return undefined;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleTimeString('zh-CN', { hour12: false });
}

/** Numeric timestamp (seconds or millis) → millis; values < 1e12 are seconds. */
function numericToMillis(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n < 1e12 ? n * 1000 : n;
}

/** ISO date string (e.g. receivedAt) → millis. */
function isoToMillis(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}
