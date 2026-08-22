import { describe, expect, it } from 'vitest';
import { LiveSourceEventSchema } from '@echocue/contracts';
import { FIXTURES, loadJsonFixture } from '../fixtures/loader.js';

interface WsEventFixture {
  version: string;
  validEvents: Array<Record<string, unknown>>;
  giftLikeFrames: Array<Record<string, unknown>>;
}

const fixture = loadJsonFixture<WsEventFixture>(FIXTURES.WS_EVENTS);

function expectEventValid(type: string): void {
  const event = fixture.validEvents.find((candidate) => candidate.type === type);
  expect(event, `fixture missing ${type} event`).toBeDefined();
  expect(LiveSourceEventSchema.safeParse(event).success).toBe(true);
}

describe('T-CON-001: WebSocket Event Fixtures', () => {
  it('should validate ONLINE event fixture', () => {
    expectEventValid('LIVE_ONLINE');
  });

  it('should validate OFFLINE event fixture', () => {
    expectEventValid('LIVE_OFFLINE');
  });

  it('should validate ENDED event fixture', () => {
    expectEventValid('LIVE_ENDED');
  });

  it('should validate COMMENT event fixture', () => {
    expectEventValid('COMMENT');
  });

  it('should reject gift/like events', () => {
    expect(fixture.giftLikeFrames.length).toBeGreaterThan(0);
    for (const frame of fixture.giftLikeFrames) {
      expect(LiveSourceEventSchema.safeParse(frame).success).toBe(false);
    }
  });
});
