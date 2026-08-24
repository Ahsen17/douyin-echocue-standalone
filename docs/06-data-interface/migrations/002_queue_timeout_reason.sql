-- self-transaction
-- WP-2: add 'QUEUE_TIMEOUT' to audit_transition.reason_code CHECK. SQLite cannot
-- ALTER a CHECK constraint, so the table is rebuilt. foreign_keys must be OFF
-- for the DROP (audit_reference references audit_transition), which is a no-op
-- inside a transaction — hence the `-- self-transaction` marker: this file owns
-- its BEGIN/COMMIT and pragmas (see MigrationRunner).
PRAGMA foreign_keys=OFF;
BEGIN;
CREATE TABLE audit_transition_new (
  trace_id TEXT NOT NULL REFERENCES audit_trace(trace_id),
  sequence_no INTEGER NOT NULL,
  from_state TEXT CHECK (
    from_state IS NULL OR from_state IN (
      'RECEIVED','NORMALIZED','FILTERED','ROUTED','RETRIEVING','DIRECT_READY',
      'PROMPT_RENDERED','LLM_PENDING','GENERATED','DISPLAY_READY','DISPLAYED',
      'HIDDEN','DISCARDED','FAILED'
    )
  ),
  to_state TEXT NOT NULL CHECK (
    to_state IN (
      'RECEIVED','NORMALIZED','FILTERED','ROUTED','RETRIEVING','DIRECT_READY',
      'PROMPT_RENDERED','LLM_PENDING','GENERATED','DISPLAY_READY','DISPLAYED',
      'HIDDEN','DISCARDED','FAILED'
    )
  ),
  reason_code TEXT NOT NULL CHECK (
    reason_code IN (
      'EVENT_RECEIVED','NORMALIZATION_OK','INPUT_SAFETY_FILTERED','PERSONA_ROUTED',
      'RETRIEVAL_STARTED','GOLDEN_DIRECT_ELIGIBLE','LLM_REQUIRED',
      'PROVIDER_REQUESTED','PROVIDER_SUCCEEDED','PROVIDER_FAILED','OUTPUT_VALIDATED',
      'OUTPUT_INVALID','OVERLAY_RENDERED','DISPLAY_DURATION_ELAPSED',
      'DISPLAY_WINDOW_ACTIVE','LOW_VALUE','PERSONA_REVIEW_UNCERTAIN',
      'STALE_SESSION','STALE_WINDOW','DEADLINE_EXCEEDED','QUEUE_TIMEOUT','AUDIT_FAILURE',
      'SOURCE_ERROR','ROOM_ENDED','USER_STOPPED'
    )
  ),
  occurred_at TEXT NOT NULL,
  previous_hmac TEXT,
  entry_hmac TEXT NOT NULL,
  PRIMARY KEY(trace_id, sequence_no)
) STRICT;
INSERT INTO audit_transition_new SELECT * FROM audit_transition;
DROP TABLE audit_transition;
ALTER TABLE audit_transition_new RENAME TO audit_transition;
COMMIT;
PRAGMA foreign_keys=ON;
