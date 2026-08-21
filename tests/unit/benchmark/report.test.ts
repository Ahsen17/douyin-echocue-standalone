import { describe, it, expect } from 'vitest';
import {
  renderBenchmarkReport,
  runFailClosedCheck,
  runRoutingBenchmark,
  runSafetyBenchmark,
  type BenchmarkReportContext,
  type BenchmarkSample,
} from '../../../src/main/benchmark/index.js';
import type { PersonaRoutingData } from '../../../src/main/persona/index.js';

const CTX: BenchmarkReportContext = { datasetId: 'demo-dataset', datasetSha256: 'abc123def' };

const TEAM: PersonaRoutingData[] = [
  {
    personaId: 'principal',
    displayName: '阿远',
    isPrincipal: true,
    aliases: [{ aliasText: '阿远', aliasKind: 'NAME', enabled: true }],
  },
  {
    personaId: 'xiaohong',
    displayName: '小红',
    isPrincipal: false,
    aliases: [{ aliasText: '小红', aliasKind: 'NICKNAME', enabled: true }],
  },
];

function sample(text: string, overrides: Partial<BenchmarkSample> = {}): BenchmarkSample {
  return {
    caseId: 'c1',
    text,
    expectedSafetyAction: 'allow',
    expectedSafetyReason: null,
    mentionedPersonaId: 'xiaohong',
    expectedPersonaId: 'xiaohong',
    expectedRouteDecision: 'exact',
    scenario: 'exact',
    ...overrides,
  };
}

describe('renderBenchmarkReport', () => {
  it('renders metadata and all sections', () => {
    const s = sample('今天状态真好，给大家分享一下吧');
    const safety = runSafetyBenchmark([s], []);
    const failClosed = runFailClosedCheck([s]);
    const routing = runRoutingBenchmark([s], TEAM);
    const report = renderBenchmarkReport(CTX, safety, failClosed, routing);

    expect(report).toContain(CTX.datasetId);
    expect(report).toContain(CTX.datasetSha256);
    expect(report).toContain('## 安全结果（POC §3）');
    expect(report).toContain('## Fail-closed 检查');
    expect(report).toContain('## 路由结果（POC §4）');
  });

  it('lists failing safety cases with expected versus actual', () => {
    const failing = sample('今天状态真好，给大家分享一下吧', {
      caseId: 'f1',
      expectedSafetyAction: 'filter',
      expectedSafetyReason: 'PII',
      expectedPersonaId: null,
      scenario: 'safety',
    });
    const safety = runSafetyBenchmark([failing], []);
    const report = renderBenchmarkReport(
      CTX,
      safety,
      runFailClosedCheck([failing]),
      runRoutingBenchmark([], TEAM),
    );
    expect(report).toContain('安全失败 case');
    expect(report).toContain('f1');
    expect(report).toContain('expected filter/PII');
    expect(report).toContain('allow=true');
  });

  it('lists failing routing cases with expected versus actual', () => {
    const failing = sample('小红今天状态真好', {
      caseId: 'rf1',
      expectedPersonaId: 'principal',
      expectedRouteDecision: 'principal_fallback',
    });
    const routing = runRoutingBenchmark([failing], TEAM);
    const report = renderBenchmarkReport(
      CTX,
      runSafetyBenchmark([failing], []),
      runFailClosedCheck([failing]),
      routing,
    );
    expect(report).toContain('路由失败 case');
    expect(report).toContain('rf1');
    expect(report).toContain('expected persona=principal');
  });

  it('never leaks sample text into the report', () => {
    const secretText = '这是一条不应出现在报告里的原文';
    const failing = sample(secretText, {
      caseId: 'f2',
      expectedSafetyAction: 'filter',
      expectedSafetyReason: 'PII',
      expectedPersonaId: null,
      scenario: 'safety',
    });
    const safety = runSafetyBenchmark([failing], []);
    const report = renderBenchmarkReport(
      CTX,
      safety,
      runFailClosedCheck([failing]),
      runRoutingBenchmark([], TEAM),
    );
    expect(report).not.toContain(secretText);
  });
});
