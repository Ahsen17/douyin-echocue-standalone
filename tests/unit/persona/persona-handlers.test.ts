import { describe, it, expect } from 'vitest';
import { createPersonaControlHandlers } from '../../../src/main/persona/index.js';
import type { PersonaSummaryV1 } from '@echocue/contracts';

describe('Persona IPC handlers (M6-02 read path)', () => {
  it('list returns personas from the store', async () => {
    const personas: PersonaSummaryV1[] = [
      {
        personaId: 'p-1',
        displayName: '小A',
        isPrincipal: true,
        activeVersion: '0193-abc',
        createdAt: '2026-08-22T00:00:00.000Z',
        updatedAt: '2026-08-22T00:00:00.000Z',
        aliasCount: 2,
        versionCount: 3,
      },
    ];
    const handlers = createPersonaControlHandlers({
      persona: { listPersonas: () => personas } as never,
    });
    await expect(handlers.list()).resolves.toEqual(personas);
  });

  it('list returns an empty array when no members exist', async () => {
    const handlers = createPersonaControlHandlers({
      persona: { listPersonas: () => [] } as never,
    });
    await expect(handlers.list()).resolves.toEqual([]);
  });
});
