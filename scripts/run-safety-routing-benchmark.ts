import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  hashDataset,
  renderBenchmarkReport,
  runFailClosedCheck,
  runRoutingBenchmark,
  runSafetyBenchmark,
  validateBenchmarkSamples,
} from '../src/main/benchmark/index.js';
import type { CompiledSafetyRuleV1 } from '../src/main/safety/index.js';
import type { PersonaRoutingData } from '../src/main/persona/index.js';

interface CliArgs {
  samples?: string;
  policy?: string;
  personas?: string;
}

const FLAGS = ['--samples', '--policy', '--personas'] as const;

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    if ((FLAGS as readonly string[]).includes(argv[i])) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`missing value for ${argv[i]}`);
      }
      args[argv[i].slice(2) as keyof CliArgs] = value;
      i++;
    }
  }
  return args;
}

function run(): void {
  const FIXTURES_DIR = resolve(process.cwd(), 'docs/06-data-interface/fixtures');
  const args = parseArgs(process.argv.slice(2));
  const samplesPath = args.samples ?? join(FIXTURES_DIR, 'safety-routing-benchmark-samples-v1.json');
  const policyPath = args.policy ?? join(FIXTURES_DIR, 'safety-routing-benchmark-policy-v1.json');
  const personasPath = args.personas ?? join(FIXTURES_DIR, 'safety-routing-benchmark-personas-v1.json');

  const dataset = JSON.parse(readFileSync(samplesPath, 'utf-8')) as Parameters<typeof validateBenchmarkSamples>[0];
  validateBenchmarkSamples(dataset);
  const compiledRules = JSON.parse(readFileSync(policyPath, 'utf-8')) as { compiledRules: CompiledSafetyRuleV1[] };
  const personas = JSON.parse(readFileSync(personasPath, 'utf-8')) as { personas: PersonaRoutingData[] };

  const safety = runSafetyBenchmark(dataset.samples, compiledRules.compiledRules);
  const failClosed = runFailClosedCheck(dataset.samples);
  const routing = runRoutingBenchmark(dataset.samples, personas.personas);

  process.stdout.write(
    renderBenchmarkReport(
      {
        datasetId: dataset.datasetId,
        datasetSha256: hashDataset(dataset),
        note: dataset.note,
      },
      safety,
      failClosed,
      routing,
    ) + '\n',
  );
}

try {
  run();
} catch (err) {
  process.stderr.write(`benchmark:safety-routing 运行失败: ${String(err)}\n`);
  process.stderr.write('用法: tsx scripts/run-safety-routing-benchmark.ts [--samples PATH] [--policy PATH] [--personas PATH]\n');
  process.exitCode = 1;
}
