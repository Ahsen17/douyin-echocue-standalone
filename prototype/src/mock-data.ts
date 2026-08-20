export const nav = ['运行','直播间与 AI','团队与人设','安全与禁忌','浮窗偏好','诊断','审计追溯','直播浮窗（原型）'] as const;
export type PageName = typeof nav[number];
export const auditRows = [
  ['20:10','@观众A 今晚好…','已展示','未打标'], ['20:09','@观众B ……','已过滤','无需打标'], ['20:08','@观众C 今天状态真好','已展示','已认可'],
];
