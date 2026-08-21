# Echocue douyinLive Windows x64 POC 记录模板 v0.1

> 状态：待执行；本文件是证据模板，不代表 POC 已通过
> 目的：关闭真实普通弹幕接入、生命周期、稳定性、凭证与许可证风险门禁

## 1. 执行元数据

| 字段 | 记录 |
| --- | --- |
| 执行日期/执行人 | 待填写 |
| Windows 版本/架构 | Windows ___ / x64 |
| Echocue build/SHA | 待填写 |
| douyinLive tag/commit/SHA-256 | 待填写 |
| 安装包 manifest/SBOM/许可证复核 | 待填写并附证据路径 |
| 测试直播间 | 仅记录脱敏引用；原值进入受保护审计 |
| 授权与风险接受人 | 待甲方填写 |

## 2. 固定测试步骤

1. 在未开播状态由用户点击启动，记录 sidecar 创建、WS 创建、`ROOM_OFFLINE`、WS close 与 sidecar 终止时间；确认无后台重连。
2. 开播后再次由用户点击启动，收到 `ROOM_ONLINE` 后连续监听至少 30 分钟。
3. 期间发送可识别的普通文本弹幕，核对 `WebcastChatMessage`、`msgId` 去重、昵称、正文和时间字段。
4. 触发突然下播，记录 `ROOM_ENDED`、WS close、attempt 取消、浮窗隐藏和 sidecar 终止时间。
5. 直播再次开播前确认 Echocue 无 WS、无自动恢复；由用户手动点击启动后重新验证 `ROOM_ONLINE`。
6. 模拟 WS 断开、端口占用、sidecar 崩溃和 malformed JSON；确认停服、无自动重连且错误码符合 06 canonical 契约。
7. 扫描日志、诊断、SQLite、Qdrant 和崩溃报告，确认没有 Cookie、Authorization、API Key 或签名信息。

## 3. 必填结果

| 指标/证据 | 结果 |
| --- | --- |
| 连续运行时长 | 待填写，目标 ≥30 分钟 |
| 收到 frame / 普通评论 / 重复评论数 | 待填写 |
| malformed / source error / 未处理崩溃数 | 待填写 |
| `ROOM_ONLINE/OFFLINE/ENDED` 事件证据 | 待填写证据路径 |
| 门禁失败到 WS close 的 P50/P95/max | 待填写 |
| 下播到 WS close 的 P50/P95/max | 待填写 |
| sidecar 进程所有权与 Job Object 退出证据 | 待填写 |
| 凭证落盘/日志扫描 | PASS/FAIL + 证据 |
| 普通弹幕完整性抽样 | 待填写样本数、缺失/重复率 |

## 4. 判定

- PASS：可连续获得普通文本弹幕；门禁/下播/断连均关闭 WS 与本应用 sidecar；无自动恢复；无未处理崩溃；无凭证泄漏；版本/SHA/SBOM/许可证证据齐全。
- FAIL：任一核心条件不满足。允许继续本地无关模块开发，但不得进入真实联调或宣称 MVP 已验收。
- 条款/风控残余风险必须由甲方书面接受，技术 PASS 不等于平台合规承诺。

| 最终结论 | 签字/日期 |
| --- | --- |
| 待执行 | 甲方：___ / 乙方：___ |
