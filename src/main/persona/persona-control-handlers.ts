import type {
  AliasRowV1,
  PersonaDetailV1,
  PersonaSummaryV1,
  PersonaVersionMetaV1,
  VersionComparisonV1,
} from '@echocue/contracts';
import {
  PersonaCompareRequestV1Schema,
  PersonaCreateRequestV1Schema,
  PersonaDeleteRequestV1Schema,
  PersonaGetRequestV1Schema,
  PersonaGetVersionContentRequestV1Schema,
  PersonaListVersionsRequestV1Schema,
  PersonaPublishRequestV1Schema,
  PersonaSaveDraftRequestV1Schema,
  PersonaSetPrincipalRequestV1Schema,
  PersonaUpdateAliasesRequestV1Schema,
  type PersonaVersionContentV1,
} from '@echocue/contracts';
import {
  AliasDuplicateError,
  AliasNotFoundError,
  PersonaInvalidParamsError,
  PersonaNotFoundError,
  PersonaPrincipalDeletionError,
  PersonaReferencedError,
  PersonaVersionImmutableError,
  PersonaVersionNotFoundError,
} from './index.js';
import { uuidv7 } from '../util/index.js';
import type { PersonaStore } from './PersonaStore.js';

export interface PersonaControlDeps {
  persona: PersonaStore;
}

export interface PersonaControlHandlers {
  list: () => Promise<PersonaSummaryV1[]>;
  get: (raw: unknown) => Promise<PersonaDetailV1>;
  create: (raw: unknown) => Promise<PersonaSummaryV1>;
  delete: (raw: unknown) => Promise<void>;
  setPrincipal: (raw: unknown) => Promise<PersonaSummaryV1>;
  saveDraft: (raw: unknown) => Promise<PersonaVersionMetaV1>;
  publish: (raw: unknown) => Promise<PersonaVersionMetaV1>;
  listVersions: (raw: unknown) => Promise<PersonaVersionMetaV1[]>;
  compare: (raw: unknown) => Promise<VersionComparisonV1>;
  getVersionContent: (raw: unknown) => Promise<PersonaVersionContentV1>;
  updateAliases: (raw: unknown) => Promise<AliasRowV1[]>;
}

// Core persona IPC logic, decoupled from electron. Domain errors are translated
// to user-facing Chinese messages; persona content is never part of any response.
export function createPersonaControlHandlers(deps: PersonaControlDeps): PersonaControlHandlers {
  const { persona } = deps;

  return {
    async list() {
      return persona.listPersonas();
    },

    async get(raw) {
      const req = requireValid(PersonaGetRequestV1Schema.safeParse(raw), '成员标识不合法');
      try {
        const summary = persona.getPersona(req.personaId);
        const versions = persona.listVersions(req.personaId);
        // Editing starts from the working draft (saveDraft updates it in place,
        // so there is at most one DRAFT per member), else the active published.
        const latestDraft = [...versions].reverse().find((v) => v.status === 'DRAFT');
        const contentVersion = latestDraft?.personaVersion ?? summary.activeVersion ?? null;
        const editableContent = contentVersion === null ? '' : persona.readVersionContent(contentVersion);
        return {
          summary,
          aliases: persona.listAliases(req.personaId),
          versions,
          editableContent,
        };
      } catch (err) {
        throw translatePersonaError(err);
      }
    },

    async create(raw) {
      const req = requireValid(PersonaCreateRequestV1Schema.safeParse(raw), '成员信息不合法');
      // The first member becomes the principal (persona principal must be unique).
      const isPrincipal = persona.listPersonas().length === 0;
      const personaId = uuidv7();
      try {
        persona.createPersona({ personaId, displayName: req.displayName, isPrincipal, aliases: req.aliases });
      } catch (err) {
        throw translatePersonaError(err);
      }
      return persona.getPersona(personaId);
    },

    async delete(raw) {
      const req = requireValid(PersonaDeleteRequestV1Schema.safeParse(raw), '成员标识不合法');
      try {
        persona.deletePersona(req.personaId);
      } catch (err) {
        throw translatePersonaError(err);
      }
    },

    async setPrincipal(raw) {
      const req = requireValid(PersonaSetPrincipalRequestV1Schema.safeParse(raw), '成员标识不合法');
      try {
        persona.updatePersona(req.personaId, { isPrincipal: true });
      } catch (err) {
        throw translatePersonaError(err);
      }
      return persona.getPersona(req.personaId);
    },

    async saveDraft(raw) {
      const req = requireValid(PersonaSaveDraftRequestV1Schema.safeParse(raw), '草稿内容不合法');
      let content = req.content;
      if (content === undefined) {
        if (req.fromVersion === undefined) throw new Error('草稿内容不合法');
        // Rollback: copy the referenced version's content into a fresh draft.
        content = persona.readVersionContent(req.fromVersion);
      }
      try {
        // 单工作草稿模型：content 直存时若该成员已有一个 DRAFT，更新它而非追加新行
        //（避免发布后残留孤儿草稿、下次编辑加载陈旧内容）。fromVersion 回滚始终新建。
        if (req.fromVersion === undefined) {
          const versions = persona.listVersions(req.personaId);
          const latestDraft = [...versions].reverse().find((v) => v.status === 'DRAFT');
          if (latestDraft !== undefined) {
            persona.updateDraftContent(latestDraft.personaVersion, content);
            return persona.getVersionMeta(latestDraft.personaVersion);
          }
        }
        return persona.createDraft({ personaId: req.personaId, content, fromVersion: req.fromVersion });
      } catch (err) {
        throw translatePersonaError(err);
      }
    },

    async publish(raw) {
      const req = requireValid(PersonaPublishRequestV1Schema.safeParse(raw), '版本标识不合法');
      try {
        persona.publishDraft(req.personaVersion);
        return persona.getVersionMeta(req.personaVersion);
      } catch (err) {
        throw translatePersonaError(err);
      }
    },

    async listVersions(raw) {
      const req = requireValid(PersonaListVersionsRequestV1Schema.safeParse(raw), '成员标识不合法');
      return persona.listVersions(req.personaId);
    },

    async compare(raw) {
      const req = requireValid(PersonaCompareRequestV1Schema.safeParse(raw), '版本标识不合法');
      return persona.compareVersions(req.a, req.b);
    },

    async getVersionContent(raw) {
      const req = requireValid(PersonaGetVersionContentRequestV1Schema.safeParse(raw), '版本标识不合法');
      try {
        // Ownership cross-check (TD-07): a version id alone must not read
        // another member's decrypted content; mismatch is reported as missing.
        const meta = persona.getVersionMeta(req.personaVersion);
        if (meta.personaId !== req.personaId) {
          throw new PersonaVersionNotFoundError(req.personaVersion);
        }
        return { personaVersion: req.personaVersion, content: persona.readVersionContent(req.personaVersion) };
      } catch (err) {
        throw translatePersonaError(err);
      }
    },

    async updateAliases(raw) {
      const req = requireValid(PersonaUpdateAliasesRequestV1Schema.safeParse(raw), '别名列表不合法');
      // Replace semantics: diff the existing rows against the submitted list.
      const target = new Map<string, { aliasText: string; aliasKind: AliasRowV1['aliasKind']; enabled?: boolean }>();
      for (const alias of req.aliases) target.set(alias.aliasText, alias);
      const existing = persona.listAliases(req.personaId);
      try {
        for (const row of existing) {
          if (!target.has(row.aliasText)) persona.deleteAlias(row.aliasId);
        }
        for (const [text, input] of target) {
          const row = existing.find((r) => r.aliasText === text);
          if (row) {
            persona.updateAlias(row.aliasId, { aliasKind: input.aliasKind, enabled: input.enabled });
          } else {
            persona.addAlias(req.personaId, input);
          }
        }
      } catch (err) {
        throw translatePersonaError(err);
      }
      return persona.listAliases(req.personaId);
    },
  };
}

function requireValid<T>(result: { success: true; data: T } | { success: false }, message: string): T {
  if (!result.success) throw new Error(message);
  return result.data;
}

function translatePersonaError(err: unknown): Error {
  if (err instanceof PersonaPrincipalDeletionError) {
    return new Error('主要出镜人员不可删除，请先指定另一名主要出镜');
  }
  if (err instanceof PersonaReferencedError) {
    return new Error('该成员已被审计数据引用，无法删除');
  }
  if (err instanceof AliasDuplicateError) {
    return new Error('别名已存在，请勿重复添加');
  }
  if (err instanceof PersonaVersionImmutableError) {
    return new Error('已发布版本不可修改，请基于草稿编辑');
  }
  if (err instanceof PersonaNotFoundError) {
    return new Error('成员不存在或已被删除');
  }
  if (err instanceof PersonaVersionNotFoundError) {
    return new Error('版本不存在');
  }
  if (err instanceof AliasNotFoundError) {
    return new Error('别名不存在');
  }
  if (err instanceof PersonaInvalidParamsError) {
    return new Error('成员参数不合法');
  }
  return err instanceof Error ? err : new Error('操作失败，请重试');
}
