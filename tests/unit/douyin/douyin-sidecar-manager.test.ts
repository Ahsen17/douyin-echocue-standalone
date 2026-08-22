import { describe, expect, it } from 'vitest';
import { DomainErrorV1Schema } from '@echocue/contracts';
import {
  DOUYIN_LIVE_HOST,
  DOUYIN_LIVE_WS_PORT,
  SidecarStartFailedError,
  SourceUnavailableError,
  gteVersion,
  parseBoundPort,
  parseVersionTag,
  renderSpawnArgs,
} from '../../../src/main/douyin/index.js';

describe('douyinLive constants', () => {
  it('pins loopback host and ws port', () => {
    expect(DOUYIN_LIVE_HOST).toBe('127.0.0.1');
    expect(DOUYIN_LIVE_WS_PORT).toBe(1088);
  });
});

describe('douyinLive sidecar error codes', () => {
  it('maps startup failures to E_SIDECAR_START_FAILED', () => {
    const error = new SidecarStartFailedError('boom');
    expect(error.code).toBe(DomainErrorV1Schema.enum.E_SIDECAR_START_FAILED);
    expect(error.name).toBe('SidecarStartFailedError');
  });

  it('maps source unavailability to E_SOURCE_UNAVAILABLE', () => {
    const error = new SourceUnavailableError('down');
    expect(error.code).toBe(DomainErrorV1Schema.enum.E_SOURCE_UNAVAILABLE);
    expect(error.name).toBe('SourceUnavailableError');
  });
});

describe('renderSpawnArgs', () => {
  it('renders the ws port flag', () => {
    expect(renderSpawnArgs(1088)).toEqual(['--port', '1088']);
  });

  it('appends extra args after the port flag', () => {
    expect(renderSpawnArgs(9000, ['--log-level', 'debug'])).toEqual([
      '--port',
      '9000',
      '--log-level',
      'debug',
    ]);
  });
});

describe('parseVersionTag', () => {
  it('extracts the version from --version output', () => {
    expect(
      parseVersionTag(
        'tag=v2.2.0 commit=006d1b2e8616 buildDate=2026-08-21T06:15:46Z source=github-actions/release#92.1 signProvider=local',
      ),
    ).toBe('2.2.0');
  });

  it('returns null when the tag is missing', () => {
    expect(parseVersionTag('no version here')).toBeNull();
  });

  it('accepts two-part versions', () => {
    expect(parseVersionTag('tag=v2.2 commit=x')).toBe('2.2');
  });
});

describe('parseBoundPort', () => {
  it('extracts the bound port from the startup log', () => {
    expect(
      parseBoundPort(
        '2026-08-22 12:10:52 INFO WebSocket 服务启动成功 stage=startup step=listen addr=ws://127.0.0.1:1088',
      ),
    ).toBe(1088);
  });

  it('returns null when the addr line is absent', () => {
    expect(parseBoundPort('no startup log yet')).toBeNull();
  });
});

describe('gteVersion', () => {
  it('compares major/minor/patch segments', () => {
    expect(gteVersion('2.2.0', '2.2.0')).toBe(true);
    expect(gteVersion('2.3.0', '2.2.9')).toBe(true);
    expect(gteVersion('2.2.1', '2.2.0')).toBe(true);
    expect(gteVersion('2.2.0', '2.3.0')).toBe(false);
    expect(gteVersion('1.9.0', '2.0.0')).toBe(false);
  });

  it('treats missing patch as zero', () => {
    expect(gteVersion('2.2', '2.2.0')).toBe(true);
  });
});
