import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, '../../docs/06-data-interface/fixtures');

export function loadJsonFixture<T = unknown>(filename: string): T {
  const filePath = path.join(FIXTURES_ROOT, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Fixture not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

export function loadJsonlFixture<T = unknown>(filename: string): T[] {
  const filePath = path.join(FIXTURES_ROOT, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Fixture not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return content
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);
}

export const FIXTURES = {
  SAFETY_POLICY: 'safety-policy-fixtures-v1.json',
  PROVIDER_CONTRACT: 'provider-contract-fixtures-v1.json',
  PERSONA_ROUTING: 'persona-routing-fixtures-v1.json',
  MIGRATION_TEST: 'migration-contract-test.mjs',
} as const;
