import { describe, expect, it, vi } from 'vitest';
import { IpcChannel } from '../../../src/shared/ipc-channels.js';
import { wireAuditControl } from '../../../src/main/audit/audit-control-ipc.js';
import { wireOverlayControl } from '../../../src/main/overlay/overlay-control-ipc.js';
import { wireConfigControl } from '../../../src/main/config/config-control-ipc.js';
import { wireProviderControl } from '../../../src/main/provider/provider-control-ipc.js';
import { wirePersonaControl } from '../../../src/main/persona/persona-control-ipc.js';
import { wireSafetyControl } from '../../../src/main/safety/safety-control-ipc.js';

const mocks = vi.hoisted(() => {
  const registered = new Map<string, (event: { sender: unknown }, raw?: unknown) => unknown>();
  const ipcMain = {
    handle: vi.fn(
      (channel: string, handler: (event: { sender: unknown }, raw?: unknown) => unknown) => {
        registered.set(channel, handler);
      },
    ),
  };
  return { registered, ipcMain };
});

vi.mock('electron', () => ({ ipcMain: mocks.ipcMain }));

const TRUSTED = { id: 1 };
const isTrusted = () => true;

const UUID_V7 = '0188c8e1-7d4b-7000-a000-000000000000';
const UUID_V4 = '550e8400-e29b-41d4-a716-446655440000';

const VALID_PREFS = {
  durationMs: 10000,
  width: 800,
  height: 200,
  opacity: 0.95,
  fontScale: 1.0,
  theme: 'dark',
  clickThrough: false,
};

function invoke(channel: string, raw?: unknown): Promise<unknown> {
  const handler = mocks.registered.get(channel);
  if (!handler) throw new Error(`no handler registered for ${channel}`);
  return handler({ sender: TRUSTED }, raw) as Promise<unknown>;
}

describe('IPC payload schema rejection at the wire boundary (M6-11 / CONTRACT §7)', () => {
  it('audit.getWorkflow rejects a non-UUID-v7 traceId before querying', async () => {
    const audit = { getTraceWorkflowV1: vi.fn(), searchTraces: vi.fn(), submitLabel: vi.fn() };
    wireAuditControl({ audit: audit as never, isTrustedSender: isTrusted as never });
    await expect(invoke(IpcChannel.AuditGetWorkflow, { traceId: 'not-a-uuid' })).rejects.toThrow(
      /traceId 必须是合法的 UUID v7/,
    );
    await expect(invoke(IpcChannel.AuditGetWorkflow, { traceId: UUID_V4 })).rejects.toThrow(
      /traceId 必须是合法的 UUID v7/,
    );
    expect(audit.getTraceWorkflowV1).not.toHaveBeenCalled();
  });

  it('audit.search rejects pageSize outside 1..100 before querying', async () => {
    const audit = { getTraceWorkflowV1: vi.fn(), searchTraces: vi.fn(), submitLabel: vi.fn() };
    wireAuditControl({ audit: audit as never, isTrustedSender: isTrusted as never });
    await expect(invoke(IpcChannel.AuditSearch, { pageSize: 0 })).rejects.toThrow(/审计查询参数不合法/);
    await expect(invoke(IpcChannel.AuditSearch, { pageSize: 101 })).rejects.toThrow(/审计查询参数不合法/);
    expect(audit.searchTraces).not.toHaveBeenCalled();
  });

  it('audit.submitLabel rejects a v4 traceId and unknown fields', async () => {
    const audit = { getTraceWorkflowV1: vi.fn(), searchTraces: vi.fn(), submitLabel: vi.fn() };
    wireAuditControl({ audit: audit as never, isTrustedSender: isTrusted as never });
    await expect(
      invoke(IpcChannel.AuditSubmitLabel, { traceId: UUID_V4, expectedRevisionNo: 0, score: 85 }),
    ).rejects.toThrow(/打标参数不合法/);
    await expect(
      invoke(IpcChannel.AuditSubmitLabel, { traceId: UUID_V7, expectedRevisionNo: 0, score: 85, leaked: 1 }),
    ).rejects.toThrow(/打标参数不合法/);
    expect(audit.submitLabel).not.toHaveBeenCalled();
  });

  it('overlay.ack rejects a malformed requestId', () => {
    const overlayWindow = { ack: vi.fn() };
    wireOverlayControl({ overlayWindow: overlayWindow as never, isOverlayTrustedSender: isTrusted as never });
    // overlay.ack is a synchronous handler, so schema rejection throws rather
    // than rejecting a promise.
    expect(() => invoke(IpcChannel.OverlayAck, {})).toThrow(/overlay ack payload invalid/);
    expect(() => invoke(IpcChannel.OverlayAck, { requestId: 123 })).toThrow(/overlay ack payload invalid/);
    expect(overlayWindow.ack).not.toHaveBeenCalled();
  });

  it('config.update rejects unknown fields and an empty update', async () => {
    const settings = { update: vi.fn(), get: vi.fn() };
    const providerConfig = { getProviderConfig: vi.fn() };
    wireConfigControl({
      settings: settings as never,
      providerConfig: providerConfig as never,
      isTrustedSender: isTrusted as never,
    });
    await expect(invoke(IpcChannel.ConfigUpdate, { leaked: 1 })).rejects.toThrow(/配置内容不合法/);
    await expect(invoke(IpcChannel.ConfigUpdate, {})).rejects.toThrow(/配置内容不合法/);
    expect(settings.update).not.toHaveBeenCalled();
  });

  it('overlay.preference.update rejects an out-of-range width', async () => {
    const settings = { update: vi.fn(), get: vi.fn() };
    wireConfigControl({ settings: settings as never, providerConfig: {}, isTrustedSender: isTrusted as never });
    await expect(
      invoke(IpcChannel.OverlayPreferenceUpdate, { ...VALID_PREFS, width: 100 }),
    ).rejects.toThrow(/浮窗偏好不合法/);
    expect(settings.update).not.toHaveBeenCalled();
  });

  it('provider.credential.set rejects a malformed providerId and unknown fields', async () => {
    const configService = { getProviderConfig: vi.fn(), setApiKey: vi.fn() };
    wireProviderControl({ configService: configService as never, isTrustedSender: isTrusted as never });
    await expect(
      invoke(IpcChannel.ProviderCredentialSet, { providerId: 'BAD ID!', apiKey: 'x' }),
    ).rejects.toThrow();
    await expect(
      invoke(IpcChannel.ProviderCredentialSet, { providerId: 'ok', apiKey: 'x', extra: 1 }),
    ).rejects.toThrow();
    expect(configService.setApiKey).not.toHaveBeenCalled();
  });

  it('persona.create rejects a blank displayName', async () => {
    const persona = { listPersonas: vi.fn(), createPersona: vi.fn() };
    wirePersonaControl({ persona: persona as never, isTrustedSender: isTrusted as never });
    await expect(invoke(IpcChannel.PersonaCreate, { displayName: '   ' })).rejects.toThrow(/成员信息不合法/);
    expect(persona.listPersonas).not.toHaveBeenCalled();
    expect(persona.createPersona).not.toHaveBeenCalled();
  });

  it('safety.saveDraft rejects an empty keyword', async () => {
    const safety = { createDraft: vi.fn() };
    wireSafetyControl({ safety: safety as never, isTrustedSender: isTrusted as never });
    await expect(
      invoke(IpcChannel.SafetySaveDraft, { policyText: 'x', keywords: [''] }),
    ).rejects.toThrow(/安全策略内容不合法/);
    expect(safety.createDraft).not.toHaveBeenCalled();
  });
});
