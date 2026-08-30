import { describe, it, expect } from 'vitest';
import type { ConfigViewV1, PersonaSummaryV1, ServiceViewState } from '@echocue/contracts';
import {
  computeConfigCompleteness,
  deriveRunState,
} from '../../../src/renderer/main/run/run-state.js';

function view(partial: Partial<ServiceViewState>): ServiceViewState {
  return { lifecycle: 'STOPPED', activity: 'IDLE', ...partial };
}

function config(partial: Partial<ConfigViewV1> = {}): ConfigViewV1 {
  return {
    overlay: {
      durationMs: 5000,
      width: 800,
      height: 200,
      opacity: 0.9,
      fontScale: 1,
      theme: 'dark',
      clickThrough: false,
    },
    apiKeyConfigured: false,
    ...partial,
  };
}

function persona(partial: Partial<PersonaSummaryV1> = {}): PersonaSummaryV1 {
  return {
    personaId: 'p-1',
    displayName: '小A',
    isPrincipal: false,
    activeVersion: null,
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
    aliasCount: 0,
    versionCount: 0,
    ...partial,
  };
}

describe('deriveRunState (UI §4 nine-state mapping)', () => {
  it('STOPPED without reason → 已停止 / 启动服务', () => {
    const r = deriveRunState(view({ lifecycle: 'STOPPED' }), true);
    expect(r.label).toBe('已停止');
    expect(r.primaryAction).toBe('start');
    expect(r.primaryLabel).toBe('启动服务');
  });

  it('GATE_CONNECTING → 正在确认直播状态 / 停止', () => {
    const r = deriveRunState(view({ lifecycle: 'GATE_CONNECTING', activity: 'GATE_CHECKING' }), true);
    expect(r.label).toBe('正在确认直播状态');
    expect(r.primaryAction).toBe('stop');
  });

  it('RUNNING + LISTENING → 正在监听 / 停止', () => {
    const r = deriveRunState(view({ lifecycle: 'RUNNING', activity: 'LISTENING' }), true);
    expect(r.label).toBe('正在监听');
    expect(r.primaryAction).toBe('stop');
  });

  it('RUNNING + RETRIEVING → 正在准备建议', () => {
    const r = deriveRunState(view({ lifecycle: 'RUNNING', activity: 'RETRIEVING' }), true);
    expect(r.label).toBe('正在准备建议');
  });

  it('RUNNING + GENERATING → 正在准备建议', () => {
    const r = deriveRunState(view({ lifecycle: 'RUNNING', activity: 'GENERATING' }), true);
    expect(r.label).toBe('正在准备建议');
  });

  it('RUNNING + DISPLAYING → 正在展示建议', () => {
    const r = deriveRunState(view({ lifecycle: 'RUNNING', activity: 'DISPLAYING' }), true);
    expect(r.label).toBe('正在展示建议');
  });

  it('STOPPED + ROOM_OFFLINE → 未启动；可手动重试 / 重试启动', () => {
    const r = deriveRunState(view({ lifecycle: 'STOPPED', stopReason: 'ROOM_OFFLINE' }), true);
    expect(r.label).toBe('未启动；可手动重试');
    expect(r.primaryAction).toBe('retry');
  });

  it('STOPPED + ROOM_ENDED → 可手动重试', () => {
    const r = deriveRunState(view({ lifecycle: 'STOPPED', stopReason: 'ROOM_ENDED' }), true);
    expect(r.primaryAction).toBe('retry');
  });

  it('STOPPED + SOURCE_ERROR → 可手动重试', () => {
    const r = deriveRunState(view({ lifecycle: 'STOPPED', stopReason: 'SOURCE_ERROR' }), true);
    expect(r.primaryAction).toBe('retry');
  });

  it('STOPPED + AUDIT_UNAVAILABLE → 审计存储不可用 / 查看诊断, start disabled', () => {
    const r = deriveRunState(view({ lifecycle: 'STOPPED', stopReason: 'AUDIT_UNAVAILABLE' }), true);
    expect(r.label).toBe('审计存储不可用');
    expect(r.primaryAction).toBe('view-diagnostics');
    expect(r.startDisabled).toBe(true);
  });

  it('STOPPED + SOURCE_ERROR with E_AUDIT_UNAVAILABLE → 审计存储不可用 (gate path)', () => {
    const r = deriveRunState(
      view({
        lifecycle: 'STOPPED',
        stopReason: 'SOURCE_ERROR',
        recoverableError: { code: 'E_AUDIT_UNAVAILABLE', at: '2026-08-22T00:00:00.000Z' },
      }),
      true,
    );
    expect(r.label).toBe('审计存储不可用');
    expect(r.startDisabled).toBe(true);
  });

  it('config incomplete overrides the lifecycle view', () => {
    const r = deriveRunState(view({ lifecycle: 'STOPPED' }), false);
    expect(r.label).toBe('需要完成基础配置后才能启动服务');
    expect(r.startDisabled).toBe(true);
  });
});

describe('computeConfigCompleteness (UI §4 first-run checklist)', () => {
  it('complete when room + provider/key + published principal all present', () => {
    const c = config({
      roomReference: 'room-1',
      provider: {
        providerId: 'p',
        displayName: 'DeepSeek',
        adapterType: 'DEEPSEEK',
        baseUrl: 'https://api.deepseek.com',
        modelId: 'deepseek-chat',
        credentialRef: 'safe-storage:p',
      },
      apiKeyConfigured: true,
    });
    const result = computeConfigCompleteness(c, [persona({ isPrincipal: true, activeVersion: 'v1' })]);
    expect(result.complete).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('missing room when no roomReference', () => {
    const result = computeConfigCompleteness(config(), [persona({ isPrincipal: true, activeVersion: 'v1' })]);
    expect(result.missing).toContain('room');
  });

  it('missing ai when no provider configured', () => {
    const c = config({ roomReference: 'room-1', apiKeyConfigured: false });
    const result = computeConfigCompleteness(c, [persona({ isPrincipal: true, activeVersion: 'v1' })]);
    expect(result.missing).toContain('ai');
  });

  it('missing ai when key not configured even with provider', () => {
    const c = config({ roomReference: 'room-1', apiKeyConfigured: false });
    const result = computeConfigCompleteness(c, [persona({ isPrincipal: true, activeVersion: 'v1' })]);
    expect(result.missing).toContain('ai');
  });

  it('missing principal when none is principal or published', () => {
    const c = config({ roomReference: 'room-1', apiKeyConfigured: true });
    const result = computeConfigCompleteness(c, [persona({ isPrincipal: false })]);
    expect(result.missing).toContain('principal');
    expect(result.complete).toBe(false);
  });
});
