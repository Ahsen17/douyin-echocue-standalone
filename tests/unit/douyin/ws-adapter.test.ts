import { describe, expect, it } from 'vitest';
import { mapUpstreamFrame } from '../../../src/main/douyin/index.js';
import type { MapFrameContext } from '../../../src/main/douyin/index.js';

const CTX: MapFrameContext = {
  roomReference: 'room-abc',
  receivedAt: '2026-08-22T12:00:00.000Z',
  receivedMonotonicMs: 1234.5,
};

describe('mapUpstreamFrame', () => {
  it('maps ROOM_ONLINE to LIVE_ONLINE with platformRoomId', () => {
    const event = mapUpstreamFrame(
      { type: 'system', event: 'live_status', code: 'ROOM_ONLINE', data: { room_id: '7012345678901234567' } },
      CTX,
    );
    expect(event).toEqual({
      type: 'LIVE_ONLINE',
      roomReference: 'room-abc',
      platformRoomId: '7012345678901234567',
      receivedAt: CTX.receivedAt,
    });
  });

  it('maps ROOM_ENDED to LIVE_ENDED', () => {
    const event = mapUpstreamFrame(
      { type: 'system', event: 'live_status', code: 'ROOM_ENDED' },
      CTX,
    );
    expect(event).toEqual({ type: 'LIVE_ENDED', roomReference: 'room-abc', receivedAt: CTX.receivedAt });
  });

  it('maps ROOM_OFFLINE to LIVE_OFFLINE', () => {
    const event = mapUpstreamFrame(
      { type: 'system', event: 'live_status', code: 'ROOM_OFFLINE' },
      CTX,
    );
    expect(event).toEqual({ type: 'LIVE_OFFLINE', roomReference: 'room-abc', receivedAt: CTX.receivedAt });
  });

  it('maps an unknown live_status code to SOURCE_ERROR', () => {
    const event = mapUpstreamFrame(
      { type: 'system', event: 'live_status', code: 'SOMETHING_ELSE' },
      CTX,
    );
    expect(event).toMatchObject({ type: 'SOURCE_ERROR', code: 'E_SOURCE_UNAVAILABLE' });
  });

  it('maps WebcastChatMessage to COMMENT with normalized text', () => {
    const event = mapUpstreamFrame(
      {
        method: 'WebcastChatMessage',
        content: '  主播 晚上好 ',
        common: { msgId: '7261234567890123456', roomId: '7012345678901234567', createTime: 1724304000 },
        user: { nickName: '观众A' },
      },
      CTX,
    );
    expect(event).toMatchObject({
      type: 'COMMENT',
      comment: {
        sourceMessageId: '7261234567890123456',
        platformRoomId: '7012345678901234567',
        rawText: '  主播 晚上好 ',
        normalizedText: '主播 晚上好',
        userNickname: '观众A',
        upstreamCreatedAt: '1724304000',
        receivedAt: CTX.receivedAt,
        receivedMonotonicMs: 1234.5,
      },
    });
  });

  it('generates a local id when msgId is missing', () => {
    const event = mapUpstreamFrame(
      { method: 'WebcastChatMessage', content: '嗨', common: { roomId: 123 } },
      CTX,
    );
    expect(event).not.toBeNull();
    if (event?.type === 'COMMENT') {
      expect(event.comment.sourceMessageId).toMatch(/^local-/);
    } else {
      throw new Error('expected COMMENT event');
    }
  });

  it('returns null for WebcastGiftMessage', () => {
    const event = mapUpstreamFrame(
      { method: 'WebcastGiftMessage', gift: { giftName: '小心心' }, common: { msgId: 1, roomId: 2 } },
      CTX,
    );
    expect(event).toBeNull();
  });

  it('returns null for WebcastLikeMessage', () => {
    const event = mapUpstreamFrame(
      { method: 'WebcastLikeMessage', likeCount: 5, common: { msgId: 1, roomId: 2 } },
      CTX,
    );
    expect(event).toBeNull();
  });

  it('returns null for non-object frames', () => {
    expect(mapUpstreamFrame(null, CTX)).toBeNull();
    expect(mapUpstreamFrame('plain string', CTX)).toBeNull();
  });
});
