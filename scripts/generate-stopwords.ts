// Build-time stop-word pipeline: assets/stopwords-curated.txt (human-reviewed
// source) -> committed TS module. Runtime must not read assets/ from disk, so
// the generated module is committed and inlined into the main-process bundle.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const SRC = join(root, 'assets', 'stopwords-curated.txt')
const OUT = join(root, 'src', 'main', 'retrieval', 'stopwords.generated.ts')

// Same acceptance rule as Bm25TextPipeline.isKeepableToken: a line that would
// never survive token filtering anyway (digits, punctuation, symbols) is
// dropped here to keep the emitted list minimal.
function isKeepableLine(line: string): boolean {
  return (
    /\p{Script=Han}/u.test(line) ||
    /\p{L}/u.test(line) ||
    /\p{N}/u.test(line) ||
    /\p{Extended_Pictographic}/u.test(line)
  );
}

function main(): void {
  const lines = readFileSync(SRC, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && isKeepableLine(l));
  const unique = [...new Set(lines)].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  const sha256 = createHash('sha256').update(unique.join('\n'), 'utf8').digest('hex');

  const body = [
    `// GENERATED FILE - DO NOT EDIT. Source: assets/stopwords-curated.txt`,
    `// Regenerate: npm run stopwords:generate`,
    `export const STOP_WORDS_SHA256_V2 = '${sha256}';`,
    ``,
    `export const CHINESE_STOP_WORDS_V2: readonly string[] = [`,
    ...unique.map((w) => `  '${w.replaceAll(`'`, `\\'`)}',`),
    `];`,
    ``,
  ].join('\n');
  writeFileSync(OUT, body);
  console.log(`wrote ${OUT} (${unique.length} stop words, sha256 ${sha256})`);
}

main()
