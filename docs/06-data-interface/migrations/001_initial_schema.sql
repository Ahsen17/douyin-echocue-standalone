-- Echocue MVP migration 001.
-- The migration runner enables foreign_keys/WAL/busy_timeout, wraps this file in
-- one transaction, and writes schema_migration(version=1, checksum=<file SHA-256>)
-- only after every statement below succeeds.

CREATE TABLE schema_migration (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL,
  checksum TEXT NOT NULL
) STRICT;

CREATE TABLE persona (
  persona_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  is_principal INTEGER NOT NULL CHECK (is_principal IN (0,1)),
  active_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX ux_persona_one_principal
  ON persona(is_principal) WHERE is_principal = 1;

CREATE TABLE persona_version (
  persona_version TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL REFERENCES persona(persona_id),
  status TEXT NOT NULL CHECK (status IN ('DRAFT','PUBLISHED','SUPERSEDED')),
  content_envelope BLOB NOT NULL,
  content_hmac TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT,
  created_from_version TEXT,
  UNIQUE(persona_id, persona_version)
) STRICT;

CREATE TABLE persona_alias (
  alias_id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL REFERENCES persona(persona_id),
  alias_text TEXT NOT NULL,
  alias_kind TEXT NOT NULL CHECK (alias_kind IN ('NAME','NICKNAME','ALIAS','TYPO_VARIANT')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  UNIQUE(persona_id, alias_text)
) STRICT;

CREATE TABLE safety_policy_version (
  safety_policy_version TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','PUBLISHED','SUPERSEDED','INVALID')),
  policy_text_envelope BLOB NOT NULL,
  keywords_envelope BLOB NOT NULL,
  compiled_rules_envelope BLOB,
  compiler_version TEXT NOT NULL,
  validation_error_envelope BLOB,
  created_at TEXT NOT NULL,
  published_at TEXT
) STRICT;

CREATE TABLE live_session (
  session_id TEXT PRIMARY KEY,
  room_reference TEXT NOT NULL,
  platform_room_id TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  end_reason TEXT,
  safety_policy_version TEXT REFERENCES safety_policy_version(safety_policy_version),
  provider_id TEXT,
  adapter_type TEXT,
  model_id TEXT
) STRICT;

CREATE TABLE audit_trace (
  trace_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES live_session(session_id),
  source_message_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  final_state TEXT CHECK (final_state IN ('FILTERED','DISCARDED','FAILED','HIDDEN')),
  label_status TEXT NOT NULL DEFAULT 'UNLABELED'
    CHECK (label_status IN ('UNLABELED','ACCEPTED','REJECTED','CORRECTED','NOT_APPLICABLE')),
  current_feedback_id TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(session_id, source_message_id)
) STRICT;

CREATE TABLE audit_transition (
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
      'STALE_SESSION','STALE_WINDOW','DEADLINE_EXCEEDED','AUDIT_FAILURE',
      'SOURCE_ERROR','ROOM_ENDED','USER_STOPPED'
    )
  ),
  occurred_at TEXT NOT NULL,
  previous_hmac TEXT,
  entry_hmac TEXT NOT NULL,
  PRIMARY KEY(trace_id, sequence_no)
) STRICT;

CREATE TABLE audit_snapshot (
  snapshot_id TEXT PRIMARY KEY,
  content_type TEXT NOT NULL CHECK (
    content_type IN (
      'RAW_EVENT_JSON','NORMALIZED_COMMENT_JSON','DECISION_JSON','PERSONA_TEXT',
      'PROMPT_TEXT','PROVIDER_META_JSON','PROVIDER_RESPONSE_JSON','SUGGESTION_JSON',
      'OVERLAY_RESULT_JSON','FINAL_REASON_JSON'
    )
  ),
  envelope BLOB NOT NULL,
  content_hmac TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE audit_reference (
  trace_id TEXT NOT NULL,
  sequence_no INTEGER NOT NULL,
  snapshot_id TEXT NOT NULL REFERENCES audit_snapshot(snapshot_id),
  role TEXT NOT NULL CHECK (
    role IN (
      'RAW_WS_EVENT','NORMALIZED_COMMENT','FILTER_DECISION','INPUT_SAFETY_DECISION',
      'PERSONA_ROUTE','PERSONA_VERSION_SNAPSHOT','GOLDEN_QUERY_RESULT','PRE_QUERY_RESULT',
      'RERANK_DECISION','RENDERED_PROMPT','LLM_REQUEST_META','LLM_RAW_RESPONSE',
      'LLM_PARSED_OUTPUT','OUTPUT_VALIDATION','OUTPUT_SAFETY_DECISION','DIRECT_PAYLOAD',
      'DIRECT_DECISION','OVERLAY_RESULT','FINAL_REASON'
    )
  ),
  PRIMARY KEY(trace_id, sequence_no, snapshot_id),
  FOREIGN KEY(trace_id, sequence_no) REFERENCES audit_transition(trace_id, sequence_no)
) STRICT;

CREATE TABLE suggestion_feedback (
  feedback_id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL REFERENCES audit_trace(trace_id),
  revision_no INTEGER NOT NULL,
  persona_id TEXT NOT NULL,
  persona_version TEXT NOT NULL,
  quality_score INTEGER CHECK (quality_score BETWEEN 0 AND 100),
  correction_envelope BLOB,
  label_status TEXT NOT NULL
    CHECK (label_status IN ('UNLABELED','ACCEPTED','REJECTED','CORRECTED','NOT_APPLICABLE')),
  sync_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED'
    CHECK (sync_status IN ('NOT_REQUIRED','PENDING','SYNCED','FAILED')),
  is_bad_case INTEGER NOT NULL DEFAULT 0 CHECK (is_bad_case IN (0,1)),
  source_collection TEXT CHECK (source_collection IN ('pre_set','golden_set')),
  source_point_id TEXT,
  target_point_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(trace_id, revision_no),
  FOREIGN KEY(persona_id, persona_version) REFERENCES persona_version(persona_id, persona_version)
) STRICT;

CREATE TABLE qdrant_sync_job (
  job_id TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL REFERENCES suggestion_feedback(feedback_id),
  target_collection TEXT NOT NULL DEFAULT 'golden_set'
    CHECK (target_collection = 'golden_set'),
  action TEXT NOT NULL CHECK (action IN ('UPSERT','SET_BAD_CASE')),
  idempotency_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('PENDING','RUNNING','SUCCEEDED','FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE audit_meta (
  key TEXT PRIMARY KEY,
  value_envelope BLOB NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX ix_audit_trace_received_at ON audit_trace(received_at DESC);
CREATE INDEX ix_audit_trace_label_received ON audit_trace(label_status, received_at DESC);
CREATE INDEX ix_feedback_trace_revision ON suggestion_feedback(trace_id, revision_no DESC);
CREATE INDEX ix_feedback_sync_created ON suggestion_feedback(sync_status, created_at);
CREATE INDEX ix_qdrant_job_state_updated ON qdrant_sync_job(state, updated_at);

CREATE TRIGGER persona_active_version_guard_insert
BEFORE INSERT ON persona WHEN NEW.active_version IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM persona_version pv
    WHERE pv.persona_version = NEW.active_version
      AND pv.persona_id = NEW.persona_id AND pv.status = 'PUBLISHED'
  ) THEN RAISE(ABORT, 'invalid active persona version') END;
END;

CREATE TRIGGER persona_active_version_guard_update
BEFORE UPDATE OF active_version ON persona WHEN NEW.active_version IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM persona_version pv
    WHERE pv.persona_version = NEW.active_version
      AND pv.persona_id = NEW.persona_id AND pv.status = 'PUBLISHED'
  ) THEN RAISE(ABORT, 'invalid active persona version') END;
END;

CREATE TRIGGER persona_version_parent_guard
BEFORE INSERT ON persona_version WHEN NEW.created_from_version IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM persona_version pv
    WHERE pv.persona_version = NEW.created_from_version
      AND pv.persona_id = NEW.persona_id
  ) THEN RAISE(ABORT, 'invalid parent persona version') END;
END;

CREATE TRIGGER qdrant_sync_job_golden_only_insert
BEFORE INSERT ON qdrant_sync_job
BEGIN
  SELECT CASE WHEN NEW.target_collection <> 'golden_set'
    THEN RAISE(ABORT, 'feedback outbox may target golden_set only') END;
  SELECT CASE WHEN NEW.action = 'SET_BAD_CASE' AND NOT EXISTS (
    SELECT 1 FROM suggestion_feedback sf
    WHERE sf.feedback_id = NEW.feedback_id
      AND sf.label_status = 'REJECTED'
      AND sf.is_bad_case = 1
      AND sf.source_collection = 'golden_set'
      AND sf.source_point_id IS NOT NULL
  ) THEN RAISE(ABORT, 'invalid golden bad-case job') END;
END;
