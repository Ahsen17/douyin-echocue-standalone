import { WebSocketServer, type WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { DouyinLiveWsAdapter } from '../../../src/main/douyin/index.js';
import { freePort } from '../retrieval/qdrant-test-utils.js';
import { createTestWebSocketServer } from '../ws-test-server.js';

const stopped: DouyinLiveWsAdapter[] = [];

afterEach(() => {
  for (const adapter of stopped.splice(0)) adapter.close();
});

function waitForClient(wss: WebSocketServer): Promise<WebSocket> {
  return new Promise((resolve) => wss.once('connection', (ws) => resolve(ws)));
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function startServer(): Promise<{ wss: WebSocketServer; port: number }> {
  const { server, port } = await createTestWebSocketServer();
  return { wss: server, port };
}

describe('DouyinLiveWsAdapter integration', () => {
  it('connects and maps upstream frames to domain events', async () => {
    const { wss, port } = await startServer();
    const adapter = new DouyinLiveWsAdapter({ host: '127.0.0.1', port, roomReference: 'room-abc' });
    stopped.push(adapter);
    const events: Array<{ type: string }> = [];
    adapter.onEvent((event) => events.push(event));
    const clientPromise = waitForClient(wss);
    try {
      await adapter.connect();
      const client = await clientPromise;
      client.send(
        JSON.stringify({ type: 'system', event: 'live_status', code: 'ROOM_ONLINE', data: { room_id: '123456' } }),
      );
      client.send(
        JSON.stringify({
          method: 'WebcastChatMessage',
          content: '主播晚上好',
          common: { msgId: '7261234567890123456', roomId: '7012345678901234567' },
          user: { nickName: '观众A' },
        }),
      );
      await waitUntil(() => events.length >= 2);
      expect(events[0]).toMatchObject({ type: 'LIVE_ONLINE', platformRoomId: '123456' });
      expect(events[1]).toMatchObject({ type: 'COMMENT' });
    } finally {
      wss.close();
    }
  });

  it('never emits COMMENT for gift/like frames', async () => {
    const { wss, port } = await startServer();
    const adapter = new DouyinLiveWsAdapter({ host: '127.0.0.1', port, roomReference: 'room-abc' });
    stopped.push(adapter);
    const events: Array<{ type: string }> = [];
    adapter.onEvent((event) => events.push(event));
    const clientPromise = waitForClient(wss);
    try {
      await adapter.connect();
      const client = await clientPromise;
      client.send(JSON.stringify({ method: 'WebcastGiftMessage', gift: { giftName: '小心心' }, common: { msgId: 1, roomId: 2 } }));
      client.send(JSON.stringify({ method: 'WebcastLikeMessage', likeCount: 5, common: { msgId: 2, roomId: 2 } }));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(events.some((event) => event.type === 'COMMENT')).toBe(false);
    } finally {
      wss.close();
    }
  });

  it('does not auto-reconnect after close', async () => {
    const { wss, port } = await startServer();
    const adapter = new DouyinLiveWsAdapter({ host: '127.0.0.1', port, roomReference: 'room-abc' });
    stopped.push(adapter);
    const events: Array<{ type: string }> = [];
    adapter.onEvent((event) => events.push(event));
    try {
      await adapter.connect();
      adapter.close();
      expect(adapter.isOpen).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(events).toHaveLength(0);
    } finally {
      wss.close();
    }
  });

  it('rejects connect when the ws endpoint is unreachable without broadcasting SOURCE_ERROR', async () => {
    const port = await freePort();
    const adapter = new DouyinLiveWsAdapter({ host: '127.0.0.1', port, roomReference: 'room-abc' });
    stopped.push(adapter);
    const events: Array<{ type: string }> = [];
    adapter.onEvent((event) => events.push(event));
    await expect(adapter.connect()).rejects.toThrow();
    expect(adapter.isOpen).toBe(false);
    expect(events).toHaveLength(0);
  });

  it('close() during connecting aborts the handshake and emits no events', async () => {
    const { wss, port } = await startServer();
    const adapter = new DouyinLiveWsAdapter({ host: '127.0.0.1', port, roomReference: 'room-abc' });
    stopped.push(adapter);
    const events: Array<{ type: string }> = [];
    adapter.onEvent((event) => events.push(event));
    try {
      const connectPromise = adapter.connect();
      adapter.close();
      await connectPromise.catch(() => undefined);
      expect(adapter.isOpen).toBe(false);
      expect(events).toHaveLength(0);
    } finally {
      wss.close();
    }
  });
});
