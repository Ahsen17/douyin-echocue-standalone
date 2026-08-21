import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(resolve(here, '../migrations/001_initial_schema.sql'), 'utf8');
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
db.exec(migration);

const now = '2026-08-21T00:00:00.000Z';
const blob = Buffer.from('{}');
const run = (sql, ...params) => db.prepare(sql).run(...params);
const mustReject = (name, action) => {
  try { action(); } catch { return; }
  throw new Error(`expected rejection: ${name}`);
};

run('INSERT INTO persona VALUES (?,?,?,?,?,?)', 'p1', '主播A', 1, null, now, now);
run('INSERT INTO persona_version VALUES (?,?,?,?,?,?,?,?)', 'pv1', 'p1', 'PUBLISHED', blob, 'same-hmac', now, now, null);
run('UPDATE persona SET active_version=? WHERE persona_id=?', 'pv1', 'p1');

// Same content HMAC is legal: rollback/copy creates a new immutable version.
run('INSERT INTO persona_version VALUES (?,?,?,?,?,?,?,?)', 'pv2', 'p1', 'PUBLISHED', blob, 'same-hmac', now, now, 'pv1');
run('UPDATE persona SET active_version=? WHERE persona_id=?', 'pv2', 'p1');

run('INSERT INTO safety_policy_version VALUES (?,?,?,?,?,?,?,?,?)', 'sp1', 'PUBLISHED', blob, blob, blob, 'SafetyRuleCompilerV1', null, now, now);
run('INSERT INTO live_session VALUES (?,?,?,?,?,?,?,?,?,?)', 's1', 'room', null, now, null, null, 'sp1', 'provider-1', 'OPENAI_COMPATIBLE', 'model-1');
run('INSERT INTO audit_trace VALUES (?,?,?,?,?,?,?,?,?)', 't1', 's1', 'm1', now, null, 'UNLABELED', null, now, null);
run('INSERT INTO audit_transition VALUES (?,?,?,?,?,?,?,?)', 't1', 1, null, 'RECEIVED', 'EVENT_RECEIVED', now, null, 'h1');
mustReject('unknown trace reason', () => run('INSERT INTO audit_transition VALUES (?,?,?,?,?,?,?,?)', 't1', 2, 'RECEIVED', 'NORMALIZED', 'UNKNOWN_REASON', now, 'h1', 'h2'));

run('INSERT INTO suggestion_feedback VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', 'f-pre', 't1', 1, 'p1', 'pv2', 0, null, 'REJECTED', 'PENDING', 1, 'pre_set', 'pre-point', null, now);
mustReject('pre_set bad case job', () => run('INSERT INTO qdrant_sync_job VALUES (?,?,?,?,?,?,?,?,?,?)', 'j-pre', 'f-pre', 'golden_set', 'SET_BAD_CASE', 'f-pre:1:SET_BAD_CASE', 'PENDING', 0, null, now, now));
mustReject('outbox target pre_set', () => run('INSERT INTO qdrant_sync_job VALUES (?,?,?,?,?,?,?,?,?,?)', 'j-target', 'f-pre', 'pre_set', 'UPSERT', 'f-pre:1:UPSERT', 'PENDING', 0, null, now, now));

run('INSERT INTO suggestion_feedback VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', 'f-golden', 't1', 2, 'p1', 'pv2', 0, null, 'REJECTED', 'PENDING', 1, 'golden_set', 'golden-point', null, now);
run('INSERT INTO qdrant_sync_job VALUES (?,?,?,?,?,?,?,?,?,?)', 'j-golden', 'f-golden', 'golden_set', 'SET_BAD_CASE', 'f-golden:2:SET_BAD_CASE', 'PENDING', 0, null, now, now);

console.log('MIGRATION_CONTRACT_TEST_OK');
