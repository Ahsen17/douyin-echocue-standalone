# Echocue Windows 安装包清单与兼容矩阵 v0.1

> 状态：发布模板；具体版本、哈希和许可证必须由 CI 对候选安装包生成，空值不可发布
> 平台：Windows x64 standalone；安装阶段不得静默从公网下载运行二进制

## 1. 进程所有权

| 组件 | 所有者 | 启动条件 | 停止条件 | 约束 |
| --- | --- | --- | --- | --- |
| Electron Main/Renderer/Overlay | 安装包主程序 | 用户启动应用 | 托盘“退出”或系统关机 | 关闭主窗口只隐藏到托盘 |
| Qdrant sidecar | Electron Main | 应用启动并通过本地完整性检查 | 托盘“退出” | 绑定 loopback；Job Object；不得残留孤儿进程 |
| douyinLive sidecar | Electron Main | 用户点击开启服务并进入门禁 | 停止服务、门禁失败、下播、源异常或退出 | 固定捆绑版本；WS 只在手动服务周期内持有 |
| AuditStoreWorker | Electron Main | 应用启动 | 托盘“退出” | SQLite 单写者；不可写时立即停服 |

## 2. 候选包 manifest

以下表格由发布流水线填写并随安装包归档；`SHA-256`、来源、许可证或 SBOM 缺一项即阻断签名发布。

| Artifact | Version / Commit | SHA-256 | Source / License | Architecture | Signature | SBOM ref |
| --- | --- | --- | --- | --- | --- | --- |
| Echocue installer | 待填 | 待填 | internal | x64 | 待填 | 待填 |
| Echocue app binary | 待填 | 待填 | internal | x64 | 待填 | 待填 |
| Electron runtime | 待填 | 待填 | upstream / 待复核 | x64 | 待填 | 待填 |
| Qdrant server | `>=1.19.0`，最终待填 | 待填 | upstream / 待复核 | x64 | 待填 | 待填 |
| douyinLive sidecar | 冻结 commit 待填 | 待填 | jwwsjlm/douyinLive / 待复核 | x64 | 待填 | 待填 |
| jieba wasm + dictionary | 待填 | 待填 | upstream / 待复核 | portable | n/a | 待填 |
| application icons | v0.1 | 待填 | project asset | SVG + generated ICO/PNG | n/a | 待填 |

## 3. 兼容矩阵

| 维度 | 受支持基线 | 发布验证 |
| --- | --- | --- |
| OS | Windows 10/11 x64，具体最低 build 待发布冻结 | 安装、启动、卸载、升级、托盘、置顶浮窗 |
| 文件系统 | 本地 NTFS | SQLite WAL、原子 rename、磁盘门禁、异常断电恢复 |
| Qdrant | 打包锁定且支持 sparse vector `modifier: idf` | 建库、索引、查询、alias 原子切换、Job Object 退出 |
| douyinLive | 打包锁定 commit | ROOM_ONLINE/OFFLINE/ENDED、WebcastChatMessage、关闭 WS/进程 |
| GPU | 不要求 | 无 GPU 环境完整运行 |
| 网络 | douyinLive 上游 + 用户配置的 HTTPS Provider | loopback 限制、代理/DNS/TLS/超时、跨 host 重定向拒绝 |

## 4. 发布与升级验收

1. CI 从锁文件和固定下载来源构建；输出 CycloneDX/SPDX SBOM、哈希清单和签名结果。
2. 安装程序在写入前验证自身资源；首次启动再次验证 sidecar 哈希，失败报 `E_SIDECAR_START_FAILED`。
3. 空配置、旧配置、旧 SQLite、现有 Qdrant profile 分别执行升级测试；migration 全部成功后才切换应用版本。
4. 发布候选必须执行真实 Windows x64 POC；douyinLive 证据填入对应 POC 报告，不得以模板代替。
5. 显式停止服务确认 douyinLive WS 与进程退出；托盘退出确认全部 child process 退出；主窗口关闭只隐藏。
6. 发布归档同时包含安装包、manifest、SBOM、签名日志、测试报告、POC artifact ID 和回滚说明。

正式发布时复制本模板为带版本和日期的只读 manifest；不得回写本设计模板伪装为历史发布证据。
