import { describe, it, expect } from 'vitest';
import {
  assertSecureHttpsUrl,
  joinUrl,
  resolveRedirectUrl,
  ProviderTransportError,
} from '../../../src/main/provider/index.js';

describe('provider http helpers', () => {
  describe('joinUrl', () => {
    it('appends path to a bare host', () => {
      expect(joinUrl('https://api.deepseek.com', '/chat/completions')).toBe(
        'https://api.deepseek.com/chat/completions',
      );
    });

    it('preserves an existing /v1 path segment', () => {
      expect(joinUrl('https://llm.example.invalid/v1', '/chat/completions')).toBe(
        'https://llm.example.invalid/v1/chat/completions',
      );
    });

    it('trims a trailing slash on the base URL', () => {
      expect(joinUrl('https://api.deepseek.com/', '/chat/completions')).toBe(
        'https://api.deepseek.com/chat/completions',
      );
    });

    it('adds a leading slash to the path when missing', () => {
      expect(joinUrl('https://api.deepseek.com', 'chat/completions')).toBe(
        'https://api.deepseek.com/chat/completions',
      );
    });
  });

  describe('assertSecureHttpsUrl', () => {
    it('accepts a plain HTTPS URL', () => {
      expect(() => assertSecureHttpsUrl('https://api.deepseek.com')).not.toThrow();
    });

    it('rejects http scheme', () => {
      expect(() => assertSecureHttpsUrl('http://api.insecure.com')).toThrow(
        ProviderTransportError,
      );
    });

    it('rejects userinfo', () => {
      expect(() => assertSecureHttpsUrl('https://user:pass@api.example.com')).toThrow(
        ProviderTransportError,
      );
    });

    it('rejects query string', () => {
      expect(() => assertSecureHttpsUrl('https://api.example.com?key=1')).toThrow(
        ProviderTransportError,
      );
    });

    it('rejects hash fragment', () => {
      expect(() => assertSecureHttpsUrl('https://api.example.com/#top')).toThrow(
        ProviderTransportError,
      );
    });

    it('rejects malformed URL', () => {
      expect(() => assertSecureHttpsUrl('not a url')).toThrow(ProviderTransportError);
    });
  });

  describe('resolveRedirectUrl', () => {
    it('follows a relative same-origin redirect', () => {
      expect(resolveRedirectUrl('https://api.example.com/v1/chat', '/v1/final')).toBe(
        'https://api.example.com/v1/final',
      );
    });

    it('follows an absolute same-origin redirect', () => {
      expect(
        resolveRedirectUrl('https://api.example.com/a', 'https://api.example.com/b'),
      ).toBe('https://api.example.com/b');
    });

    it('rejects a cross-host redirect', () => {
      expect(() =>
        resolveRedirectUrl('https://api.example.com/a', 'https://evil.example.com/b'),
      ).toThrow(ProviderTransportError);
    });

    it('rejects a protocol downgrade to http', () => {
      expect(() =>
        resolveRedirectUrl('https://api.example.com/a', 'http://api.example.com/b'),
      ).toThrow(ProviderTransportError);
    });

    it('rejects a redirect target with userinfo', () => {
      expect(() =>
        resolveRedirectUrl('https://api.example.com/a', 'https://user:pass@api.example.com/b'),
      ).toThrow(ProviderTransportError);
    });

    it('rejects a redirect target with query', () => {
      expect(() =>
        resolveRedirectUrl('https://api.example.com/a', 'https://api.example.com/b?x=1'),
      ).toThrow(ProviderTransportError);
    });

    it('rejects a redirect target with fragment', () => {
      expect(() =>
        resolveRedirectUrl('https://api.example.com/a', 'https://api.example.com/b#top'),
      ).toThrow(ProviderTransportError);
    });

    it('rejects an invalid redirect location', () => {
      expect(() => resolveRedirectUrl('https://api.example.com/a', 'http://')).toThrow(
        ProviderTransportError,
      );
    });
  });
});
