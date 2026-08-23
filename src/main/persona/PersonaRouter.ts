import type { PersonaStore } from './PersonaStore.js';
import {
  PersonaRouterUnavailableError,
  routePersona,
  type PersonaRouteDecision,
  type PersonaRoutingData,
  type RouteCandidate,
  type RouteDecision,
} from './router.js';

export interface PersonaRoute extends RouteDecision {
  personaId: string;
  personaVersion: string;
  displayName: string;
  personaMarkdown: string;
  decision: PersonaRouteDecision;
  candidates: RouteCandidate[];
}

// Resolves a routed persona to its published snapshot. A member without a
// published version falls back to the principal; if the principal also has
// none, routing is unavailable (fail closed).
export class PersonaRouter {
  constructor(private readonly store: PersonaStore) {}

  route(normalizedText: string): PersonaRoute {
    const personas = this.store.listPersonas();
    const routingData: PersonaRoutingData[] = personas.map((p) => ({
      personaId: p.personaId,
      displayName: p.displayName,
      isPrincipal: p.isPrincipal,
      aliases: this.store.listAliases(p.personaId).map((a) => ({
        aliasText: a.aliasText,
        aliasKind: a.aliasKind,
        enabled: a.enabled,
      })),
    }));

    const decision = routePersona(normalizedText, routingData);
    const resolved = this.resolvePublishedSnapshot(decision, routingData);
    return resolved;
  }

  private resolvePublishedSnapshot(
    decision: RouteDecision,
    routingData: PersonaRoutingData[],
  ): PersonaRoute {
    let targetId = decision.personaId;
    let finalDecision = decision.decision;
    let summary = this.store.getPersona(targetId);

    const target = routingData.find((p) => p.personaId === targetId);
    if (target !== undefined && !target.isPrincipal && summary.activeVersion === null) {
      // Member was named but has no persona to use; route to the principal.
      const principal = routingData.find((p) => p.isPrincipal);
      if (!principal) {
        throw new PersonaRouterUnavailableError('No principal persona configured for routing');
      }
      targetId = principal.personaId;
      finalDecision = 'principal_fallback';
      summary = this.store.getPersona(targetId);
    }

    if (summary.activeVersion === null) {
      throw new PersonaRouterUnavailableError(
        `No published persona version to route: ${targetId}`,
      );
    }
    return {
      personaId: targetId,
      personaVersion: summary.activeVersion,
      displayName: summary.displayName,
      personaMarkdown: this.store.readVersionContent(summary.activeVersion),
      decision: finalDecision,
      candidates: decision.candidates,
    };
  }
}
