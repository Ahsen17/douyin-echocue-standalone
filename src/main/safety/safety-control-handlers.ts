import type {
  SafetyPolicyCurrentV1,
  SafetyPolicyViewV1,
  SafetyPolicyVersionMetaV1,
  SafetySaveDraftResultV1,
} from '@echocue/contracts';
import {
  SafetyPublishRequestV1Schema,
  SafetySaveDraftRequestV1Schema,
} from '@echocue/contracts';
import {
  SafetyPolicyContentDecryptionError,
  SafetyPolicyImmutableError,
  SafetyPolicyInvalidError,
  SafetyPolicyInvalidParamsError,
  SafetyPolicyNotFoundError,
  SafetyPolicyUnavailableError,
} from './index.js';
import type { SafetyPolicyStore } from './SafetyPolicyStore.js';

export interface SafetyControlDeps {
  safety: SafetyPolicyStore;
}

export interface SafetyControlHandlers {
  get: () => Promise<SafetyPolicyViewV1>;
  saveDraft: (raw: unknown) => Promise<SafetySaveDraftResultV1>;
  publish: (raw: unknown) => Promise<SafetyPolicyVersionMetaV1>;
}

// Core safety-policy IPC logic, decoupled from electron. Domain errors are
// translated to user-facing Chinese messages; compiled rules never appear in
// any response, only policy text, keywords and compile validation (CONTRACT §7).
export function createSafetyControlHandlers(deps: SafetyControlDeps): SafetyControlHandlers {
  const { safety } = deps;

  return {
    async get() {
      try {
        const versions = safety.listVersions();
        const activeVersionId = await safety.getActivePublishedVersion();
        const activeVersion = activeVersionId === null ? null : safety.getVersionMeta(activeVersionId);
        // Editing starts from the latest draft attempt (DRAFT or the INVALID
        // result of a rejected save), else the active published content, else
        // nothing. INVALID must stay editable so the UI can surface the
        // compile errors that blocked publishing (UI §7.2).
        const latestDraft = [...versions].reverse().find((v) => v.status === 'DRAFT' || v.status === 'INVALID');
        const currentVersionId = latestDraft?.safetyPolicyVersion ?? activeVersionId;
        const current = currentVersionId === null ? null : toCurrentContent(safety, currentVersionId);
        return { activeVersion, current, versions };
      } catch (err) {
        throw translateSafetyError(err);
      }
    },

    async saveDraft(raw) {
      const req = requireValid(SafetySaveDraftRequestV1Schema.safeParse(raw), '安全策略内容不合法');
      let meta;
      try {
        meta = safety.createDraft({ policyText: req.policyText, keywords: req.keywords });
      } catch (err) {
        throw translateSafetyError(err);
      }
      try {
        const content = safety.readPolicy(meta.safetyPolicyVersion);
        return {
          versionMeta: meta,
          valid: meta.status === 'DRAFT',
          errors: (content.validationErrors ?? []).map(localizeCompileError),
        };
      } catch (err) {
        throw translateSafetyError(err);
      }
    },

    async publish(raw) {
      const req = requireValid(SafetyPublishRequestV1Schema.safeParse(raw), '版本标识不合法');
      try {
        safety.publishDraft(req.safetyPolicyVersion);
        // Activation updates the settings pointer the audit snapshots reference;
        // a missing pointer keeps the runtime fail-closed (ARCH §4.4).
        await safety.activatePublishedVersion(req.safetyPolicyVersion);
        return safety.getVersionMeta(req.safetyPolicyVersion);
      } catch (err) {
        throw translateSafetyError(err);
      }
    },
  };
}

function toCurrentContent(safety: SafetyPolicyStore, versionId: string): SafetyPolicyCurrentV1 {
  const content = safety.readPolicy(versionId);
  return {
    versionId,
    policyText: content.policyText,
    keywords: content.keywords,
    // Stored compiler diagnostics are English; the settings page is Chinese-only.
    validationErrors: (content.validationErrors ?? []).map(localizeCompileError),
  };
}

function requireValid<T>(result: { success: true; data: T } | { success: false }, message: string): T {
  if (!result.success) throw new Error(message);
  return result.data;
}

// The compiler emits English diagnostics; the settings page is Chinese-only.
function localizeCompileError(error: { clauseIndex: number; message: string }): {
  clauseIndex: number;
  message: string;
} {
  const keywordMatch = /^(empty|invalid) regex pattern for keyword #(\d+)$/.exec(error.message);
  if (keywordMatch) {
    const position = Number(keywordMatch[2]) + 1;
    const kind = keywordMatch[1] === 'empty' ? '模式为空' : '不是合法正则';
    return { clauseIndex: error.clauseIndex, message: `第 ${position} 个正则关键词${kind}` };
  }
  switch (error.message) {
    case 'clause has no leading negation':
      return { clauseIndex: error.clauseIndex, message: '该子句缺少「不要/禁止」等明确否定词，无法确定性解释' };
    case 'clause has no concrete topic':
      return { clauseIndex: error.clauseIndex, message: '该子句没有明确话题，请写出具体要规避的内容' };
    case 'topic is ambiguous or vague':
      return { clauseIndex: error.clauseIndex, message: '该话题无法确定性解释，请改成明确话题或关键词' };
    default:
      return error;
  }
}

function translateSafetyError(err: unknown): Error {
  if (err instanceof SafetyPolicyUnavailableError) {
    return new Error('安全策略存储不可用，请重试');
  }
  if (err instanceof SafetyPolicyNotFoundError) {
    return new Error('安全策略版本不存在');
  }
  if (err instanceof SafetyPolicyInvalidError) {
    return new Error('该版本未通过校验，不能发布');
  }
  if (err instanceof SafetyPolicyImmutableError) {
    return new Error('仅未发布的草稿可发布，已发布版本不可修改');
  }
  if (err instanceof SafetyPolicyInvalidParamsError) {
    return new Error('参数不合法');
  }
  if (err instanceof SafetyPolicyContentDecryptionError) {
    return new Error('策略内容读取失败');
  }
  return err instanceof Error ? err : new Error('操作失败，请重试');
}
