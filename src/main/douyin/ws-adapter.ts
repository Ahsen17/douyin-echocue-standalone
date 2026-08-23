import { WebSocket, type RawData } from 'ws';
import {
  DomainErrorV1Schema,
  LiveSourceEventSchema,
  type LiveSourceEvent,
  type SourceComment,
} from '@echocue/contracts';
import { DOUYIN_LIVE_HOST, DOUYIN_LIVE_WS_PORT } from './constants.js';
import { normalizeComment } from '../safety/index.js';
import { uuidv7 } from '../util/index.js';

export interface MapFrameContext {
  roomReference: string;
  receivedAt: string;
  receivedMonotonicMs: number;
}

export interface DouyinLiveWsAdapterOptions {
  host?: string;
  port?: number;
  roomReference: string;
}

export type LiveEventListener = (event: LiveSourceEvent) => void;

function roomIdOf(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.length > 0) return value;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function dataToText(raw: RawData): string {
  if (typeof raw === 'string') return raw;
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
  return Buffer.concat(raw).toString('utf8');
}

// Raw upstream frame → domain event; gift/like return null (diagnostics only).
// Field policy: non-critical fields are omitted when unreadable; critical fields
// (live_status `code`, chat `content`) drop the event entirely when unreadable.
export function mapUpstreamFrame(frame: unknown, ctx: MapFrameContext): LiveSourceEvent | null {
  if (!isRecord(frame)) return null;

  if (frame.type === 'system' && frame.event === 'live_status') {
    // code decides the event kind; an unreadable code cannot be classified.
    const code = frame.code;
    if (typeof code !== 'string' || code.length === 0) return null;
    if (code === 'ROOM_ONLINE') {
      const data = isRecord(frame.data) ? frame.data : {};
      // platformRoomId is optional; fall back from the nested data object to the
      // frame root (the douyinLive sidecar emits room_id at the top level).
      const platformRoomId = roomIdOf(data.room_id ?? data.roomId ?? frame.room_id);
      return {
        type: 'LIVE_ONLINE',
        roomReference: ctx.roomReference,
        ...(platformRoomId !== undefined ? { platformRoomId } : {}),
        receivedAt: ctx.receivedAt,
      };
    }
    if (code === 'ROOM_ENDED') {
      return { type: 'LIVE_ENDED', roomReference: ctx.roomReference, receivedAt: ctx.receivedAt };
    }
    if (code === 'ROOM_OFFLINE') {
      return { type: 'LIVE_OFFLINE', roomReference: ctx.roomReference, receivedAt: ctx.receivedAt };
    }
    return {
      type: 'SOURCE_ERROR',
      code: DomainErrorV1Schema.enum.E_SOURCE_UNAVAILABLE,
      message: `unknown live_status code: ${code}`,
      receivedAt: ctx.receivedAt,
    };
  }

  if (frame.method === 'WebcastChatMessage') {
    // content is critical: a comment without readable text cannot feed the
    // generation pipeline, so filter the frame out instead of forwarding it.
    const rawText = typeof frame.content === 'string' ? frame.content : '';
    if (rawText.trim().length === 0) return null;
    return { type: 'COMMENT', comment: buildSourceComment(frame, ctx) };
  }

  // WebcastGiftMessage / WebcastLikeMessage / unknown: not a generation input
  return null;
}

function buildSourceComment(frame: Record<string, unknown>, ctx: MapFrameContext): SourceComment {
  const common = isRecord(frame.common) ? frame.common : {};
  const user = isRecord(frame.user) ? frame.user : {};
  const msgId = common.msgId;
  const sourceMessageId =
    typeof msgId === 'string' && msgId.length > 0
      ? msgId
      : typeof msgId === 'number' && Number.isFinite(msgId)
        ? String(msgId)
        : `local-${uuidv7()}`;
  const rawText = typeof frame.content === 'string' ? frame.content : '';
  const nickname =
    typeof user.nickName === 'string' && user.nickName.length > 0
      ? user.nickName
      : typeof user.nickname === 'string' && user.nickname.length > 0
        ? user.nickname
        : undefined;
  const createTime = common.createTime;
  const upstreamCreatedAt = createTime !== undefined ? String(createTime) : undefined;
  const platformRoomId = roomIdOf(common.roomId);

  return {
    sourceMessageId,
    ...(platformRoomId !== undefined ? { platformRoomId } : {}),
    rawEvent: frame,
    rawText,
    normalizedText: normalizeComment(rawText),
    ...(nickname !== undefined ? { userNickname: nickname } : {}),
    ...(upstreamCreatedAt !== undefined ? { upstreamCreatedAt } : {}),
    receivedAt: ctx.receivedAt,
    receivedMonotonicMs: ctx.receivedMonotonicMs,
  };
}

export class DouyinLiveWsAdapter {
  private readonly url: string;
  private readonly roomReference: string;
  private readonly listeners = new Set<LiveEventListener>();
  private ws: WebSocket | null = null;
  private explicitClose = false;

  constructor(options: DouyinLiveWsAdapterOptions) {
    const host = options.host ?? DOUYIN_LIVE_HOST;
    const port = options.port ?? DOUYIN_LIVE_WS_PORT;
    this.roomReference = options.roomReference;
    this.url = `ws://${host}:${port}/ws/${options.roomReference}`;
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  onEvent(listener: LiveEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.explicitClose = false;
      const ws = new WebSocket(this.url);
      this.ws = ws;
      let opened = false;

      const onOpen = () => {
        if (this.explicitClose || this.ws !== ws) return;
        opened = true;
        ws.off('error', onOpenError);
        resolve();
      };
      const onOpenError = (err: Error) => {
        if (opened) return;
        ws.off('open', onOpen);
        reject(err);
      };
      ws.once('open', onOpen);
      ws.once('error', onOpenError);

      ws.on('message', (data) => this.handleFrame(data));
      ws.on('error', () => {
        /* connection loss is reported via close */
      });
      ws.on('close', () => {
        if (opened && !this.explicitClose) this.emitSourceError('ws closed unexpectedly');
      });
    });
  }

  close(): void {
    this.explicitClose = true;
    const ws = this.ws;
    this.ws = null;
    if (ws) ws.close();
  }

  private handleFrame(raw: RawData): void {
    const receivedMonotonicMs = performance.now();
    const receivedAt = new Date().toISOString();
    let parsed: unknown;
    try {
      parsed = JSON.parse(dataToText(raw));
    } catch {
      this.emitSourceError('malformed ws frame');
      return;
    }
    const event = mapUpstreamFrame(parsed, {
      roomReference: this.roomReference,
      receivedAt,
      receivedMonotonicMs,
    });
    if (event === null) return;
    const result = LiveSourceEventSchema.safeParse(event);
    if (!result.success) {
      this.emitSourceError('mapped event failed schema validation');
      return;
    }
    for (const listener of this.listeners) listener(result.data);
  }

  private emitSourceError(message: string): void {
    const event: LiveSourceEvent = {
      type: 'SOURCE_ERROR',
      code: DomainErrorV1Schema.enum.E_SOURCE_UNAVAILABLE,
      message,
      receivedAt: new Date().toISOString(),
    };
    for (const listener of this.listeners) listener(event);
  }
}
