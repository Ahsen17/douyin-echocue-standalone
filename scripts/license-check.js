#!/usr/bin/env node
// Checks all dependencies for prohibited copyleft licenses, writes licenses.json.
import { execSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';

const PROHIBITED = new Set([
  'GPL-2.0', 'GPL-2.0-only', 'GPL-2.0-or-later',
  'GPL-3.0', 'GPL-3.0-only', 'GPL-3.0-or-later',
  'AGPL-3.0', 'AGPL-3.0-only', 'AGPL-3.0-or-later',
  'LGPL-2.0', 'LGPL-2.0-only', 'LGPL-2.0-or-later',
  'LGPL-2.1', 'LGPL-2.1-only', 'LGPL-2.1-or-later',
  'LGPL-3.0', 'LGPL-3.0-only', 'LGPL-3.0-or-later',
]);

mkdirSync('dist/compliance', { recursive: true });

const raw = execSync('./node_modules/.bin/license-checker --json', { encoding: 'utf8' });
const licenses = JSON.parse(raw);

writeFileSync('dist/compliance/licenses.json', JSON.stringify(licenses, null, 2));

const violations = [];
for (const [pkg, info] of Object.entries(licenses)) {
  const lic = (info.licenses || '').toString();
  for (const prohibited of PROHIBITED) {
    if (lic.includes(prohibited)) {
      violations.push({ pkg, license: lic });
      break;
    }
  }
}

const total = Object.keys(licenses).length;
console.log(`License check: ${total} packages scanned`);

if (violations.length > 0) {
  console.error(`FAIL: ${violations.length} prohibited license(s) found:`);
  violations.forEach(v => console.error(`  ${v.pkg}: ${v.license}`));
  process.exit(1);
}

console.log('OK: no prohibited licenses found');
