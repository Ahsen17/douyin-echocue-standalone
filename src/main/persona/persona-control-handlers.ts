import type { PersonaSummaryV1 } from '@echocue/contracts';
import type { PersonaStore } from './PersonaStore.js';

export interface PersonaControlDeps {
  persona: PersonaStore;
}

export interface PersonaControlHandlers {
  list: () => Promise<PersonaSummaryV1[]>;
}

// Core persona IPC logic, decoupled from electron for unit-testing. M6-02 only
// needs the read path (run page completeness); write channels land in M6-04.
export function createPersonaControlHandlers(deps: PersonaControlDeps): PersonaControlHandlers {
  return {
    async list() {
      return deps.persona.listPersonas();
    },
  };
}
