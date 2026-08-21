import { describe, it, expect } from 'vitest';
import { loadJsonFixture, FIXTURES } from '../fixtures/index.js';

describe('T-PROV-001: Provider Contract Fixtures', () => {
  it('should load provider contract fixture', () => {
    const fixture = loadJsonFixture(FIXTURES.PROVIDER_CONTRACT);
    expect(fixture).toBeDefined();
  });

  it.todo('should validate DeepSeek success case');
  it.todo('should validate OpenAI-compatible success case');
  it.todo('should reject tool_calls with E_PROVIDER_PROTOCOL');
  it.todo('should handle timeout with E_PROVIDER_TIMEOUT');
  it.todo('should reject invalid output with E_PROVIDER_OUTPUT_INVALID');
});
