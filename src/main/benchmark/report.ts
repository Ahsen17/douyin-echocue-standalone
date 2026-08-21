import type { FailClosedResult, SafetyBenchmarkResult } from './safety-benchmark.js';
import type { RoutingBenchmarkResult } from './routing-benchmark.js';

export interface BenchmarkReportContext {
  datasetId: string;
  datasetSha256: string;
  note?: string;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function renderSafetyReport(result: SafetyBenchmarkResult): string {
  const lines = [
    '## 安全结果（POC §3）',
    '',
    '| 类别 | 样本数 | 应拦截 | 实际拦截 | 漏放 | 误杀 | 备注 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const s of result.byCategory) {
    lines.push(
      `| ${escapeCell(s.category)} | ${s.total} | ${s.expectedFilter} | ${s.actualFilter} | ${s.missed} | ${s.falsePositive} | |`,
    );
  }
  const totalExpected = result.byCategory.reduce((sum, c) => sum + c.expectedFilter, 0);
  const totalActual = result.byCategory.reduce((sum, c) => sum + c.actualFilter, 0);
  lines.push(
    `| 合计 | ${result.total} | ${totalExpected} | ${totalActual} | ${result.missed} | ${result.falsePositive} | 通过 ${result.passed} / 错误 reason ${result.wrongReason} |`,
  );
  return lines.join('\n');
}

export function renderRoutingReport(result: RoutingBenchmarkResult): string {
  const lines = [
    '## 路由结果（POC §4）',
    '',
    '| 场景 | 样本数 | 正确 | 歧义保守处理 | 错误 | 备注 |',
    '| --- | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const s of result.byScenario) {
    lines.push(
      `| ${escapeCell(s.scenario)} | ${s.total} | ${s.passed} | ${s.conservative} | ${s.wrong} | |`,
    );
  }
  return lines.join('\n');
}

export function renderFailClosedReport(result: FailClosedResult): string {
  return [
    '## Fail-closed 检查（POC §3）',
    '',
    '| 指标 | 值 |',
    '| --- | --- |',
    `| 样本数 | ${result.total} |`,
    `| 全部 fail closed（SAFETY_ENGINE_ERROR） | ${result.passed} |`,
    `| 未 fail closed | ${result.failed} |`,
  ].join('\n');
}

function renderSafetyFailures(result: SafetyBenchmarkResult): string[] {
  const failures = result.perSample.filter((r) => !r.passed);
  if (failures.length === 0) {
    return [];
  }
  const lines = ['### 安全失败 case', ''];
  for (const r of failures) {
    lines.push(
      `- ${r.caseId}: expected ${r.expectedSafetyAction}/${r.expectedSafetyReason ?? '-'}, ` +
        `actual allow=${r.decision.allow} reason=${r.decision.reason ?? '-'}`,
    );
  }
  return lines;
}

function renderRoutingFailures(result: RoutingBenchmarkResult): string[] {
  const failures = result.perSample.filter((r) => !r.passed);
  if (failures.length === 0) {
    return [];
  }
  const lines = ['### 路由失败 case', ''];
  for (const r of failures) {
    lines.push(
      `- ${r.caseId}: expected persona=${r.expectedPersonaId ?? '-'} ${r.expectedRouteDecision ?? ''}` +
        `, actual persona=${r.route.personaId} (${r.route.decision})`,
    );
  }
  return lines;
}

export function renderBenchmarkReport(
  ctx: BenchmarkReportContext,
  safety: SafetyBenchmarkResult,
  failClosed: FailClosedResult,
  routing: RoutingBenchmarkResult,
): string {
  const lines = [
    '# 安全与路由基准报告',
    '',
    `- 数据集 ID: ${escapeCell(ctx.datasetId)}`,
    `- 样本内容 SHA-256: ${ctx.datasetSha256}`,
    ...(ctx.note ? [`- 说明: ${escapeCell(ctx.note)}`] : []),
    '',
    renderSafetyReport(safety),
    '',
    renderFailClosedReport(failClosed),
    '',
    renderRoutingReport(routing),
    '',
    ...renderSafetyFailures(safety),
    '',
    ...renderRoutingFailures(routing),
    '',
  ];
  return lines.join('\n');
}
