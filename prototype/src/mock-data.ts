export const nav = ['运行','直播间与 AI','团队与人设','安全与禁忌','浮窗偏好','诊断','审计追溯','直播浮窗（原型）'] as const;
export type PageName = typeof nav[number];
export type RunFixture = 'UNCONFIGURED' | 'STOPPED' | 'GATE_CONNECTING' | 'LISTENING' | 'GENERATING' | 'DISPLAYING' | 'ROOM_OFFLINE' | 'SOURCE_ERROR' | 'AUDIT_UNAVAILABLE';
export const runFixtures: Record<RunFixture, {label:string; tone:string; detail:string; action:string}> = {
  UNCONFIGURED:{label:'尚未完成配置',tone:'warning',detail:'请先配置直播间、人设、安全规则和 AI 服务。',action:'完成配置'},
  STOPPED:{label:'已停止',tone:'neutral',detail:'配置完整，可以手动启动服务。',action:'启动服务'},
  GATE_CONNECTING:{label:'正在确认直播状态',tone:'warning',detail:'正在创建一次门禁连接；不会自动重试。',action:'停止'},
  LISTENING:{label:'正在监听',tone:'success',detail:'已通过开播门禁，等待最新安全弹幕。',action:'停止服务'},
  GENERATING:{label:'正在准备建议',tone:'success',detail:'正在处理当前唯一 SuggestionAttempt。',action:'停止服务'},
  DISPLAYING:{label:'正在展示建议',tone:'success',detail:'展示期内仍审计弹幕，但不生成、不排队。',action:'停止服务'},
  ROOM_OFFLINE:{label:'直播间尚未开播',tone:'warning',detail:'连接已关闭，请确认开播后手动重试。',action:'手动重试'},
  SOURCE_ERROR:{label:'弹幕接入已中断',tone:'danger',detail:'连接与 sidecar 已关闭；检查诊断后手动重试。',action:'查看诊断'},
  AUDIT_UNAVAILABLE:{label:'审计存储不可用',tone:'danger',detail:'服务已停止；修复存储后才能重新启动。',action:'查看诊断'},
};
export interface AuditRecord {id:string; time:string; comment:string; result:string; label:'未打标'|'已认可'|'已拒绝'|'已修正'|'无需打标'; hasSuggestion:boolean}
export const auditRows: AuditRecord[] = [
  {id:'019-a',time:'20:10:01.120',comment:'@观众A 今晚好，今天状态真好',result:'已展示后隐藏',label:'未打标',hasSuggestion:true},
  {id:'019-b',time:'20:09:42.310',comment:'@观众B 住址在哪里',result:'已过滤',label:'无需打标',hasSuggestion:false},
  {id:'019-c',time:'20:08:18.008',comment:'@观众C 这反应也太快了',result:'已展示后隐藏',label:'已认可',hasSuggestion:true},
  {id:'019-d',time:'20:07:03.907',comment:'@观众D 再讲刚才那个',result:'展示前失效',label:'无需打标',hasSuggestion:false},
];
