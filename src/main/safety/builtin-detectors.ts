import type { SafetyReasonCodeV1 } from '@echocue/contracts';

// Always-on base risk detectors (ARCH §4.4 step 2), independent of the
// team-configured policy. First matching category in BUILTIN_ORDER wins.
export type BuiltinRiskCategory = Exclude<SafetyReasonCodeV1, 'TEAM_FORBIDDEN' | 'SAFETY_ENGINE_ERROR'>;

export const BUILTIN_ORDER: readonly BuiltinRiskCategory[] = [
  'ABUSE',
  'PII',
  'POLITICS',
  'SEXUAL',
  'ILLEGAL',
  'MEDICAL_FINANCIAL_ADVICE',
  'COMPETITOR',
  'TRANSACTION_PRICE',
];

// Terms are matched as substrings on NFKC/lowercased text; keep them specific
// enough to avoid over-filtering benign messages.
export const BUILTIN_CATEGORY_TERMS: Record<BuiltinRiskCategory, readonly string[]> = {
  ABUSE: ['侮辱', '谩骂', '辱骂', '挑衅', '骂人', '去死', '白痴', '贱人', '脑残'],
  PII: ['住址', '家庭地址', '家庭住址', '手机号', '手机号码', '电话号码', '电话号', '微信号', '身份证号', '身份证', '真实姓名'],
  POLITICS: ['政治', '选举', '领导人', '政治局', '政府'],
  SEXUAL: ['色情', '裸照', '约炮', '做爱', '床照'],
  ILLEGAL: ['违法', '犯罪', '赌博', '毒品', '诈骗', '枪支'],
  MEDICAL_FINANCIAL_ADVICE: ['医疗', '用药', '吃药', '投资', '理财', '股票', '基金', '贷款'],
  COMPETITOR: ['竞品', '别家', '友商', '其他平台'],
  TRANSACTION_PRICE: ['价格', '多少钱', '最低价', '优惠', '下单', '交易', '砍价', '秒杀价'],
};

// First matching category wins; overlap between terms is resolved by BUILTIN_ORDER.
export function detectBuiltinRisk(normalizedText: string): SafetyReasonCodeV1 | null {
  for (const category of BUILTIN_ORDER) {
    const terms = BUILTIN_CATEGORY_TERMS[category];
    for (const term of terms) {
      if (normalizedText.includes(term)) {
        return category;
      }
    }
  }
  return null;
}
