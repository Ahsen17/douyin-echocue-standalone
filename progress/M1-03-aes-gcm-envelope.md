# M1-03 完成总结

| 项 | 内容 |
|---|---|
| 任务 ID | M1-03 |
| 任务名称 | 实现 AES-GCM envelope、HMAC 与 DPAPI 包装 |
| 状态 | ✅ 已完成 |
| 完成时间 | 2026-08-21 |
| 产出文件 | src/main/crypto/{types,field-encryptor,content-hmac,key-manager,index}.ts, tests/integration/crypto/aes-gcm-envelope.test.ts |

## 交付说明

**代码路径：** `src/main/crypto/`

**模块入口：** `src/main/crypto/index.ts`

**公开接口：**
- `FieldEncryptor(dek, keyVersion)` — `.encrypt(buf, aad)` / `.decrypt(blob, aad)`
- `buildAad(tableName, primaryKey, columnOrContentType)` — 生成 AAD 字符串
- `contentHmac(content, hmacKey)` — HMAC-SHA-256 hex
- `CryptoKeyManager(credentialStore)` — `.ensureKeys(version)` / `.getDek(v)` / `.getHmacKey(v)`
- `AesGcmEnvelopeV1` 类型

**测试命令：** `npm run test`（包含 `tests/integration/crypto/aes-gcm-envelope.test.ts`）

**已知限制：**
- `CryptoKeyManager` 采用 in-memory cache；进程重启后自动从 CredentialStore 加载
- 密钥版本目前由调用方管理，M1-04/M1-05 将在初始化时调用 `ensureKeys`

**对应 testcase/Acceptance：** T-AUD-001

**不影响契约、migration、fixture、UI 或安装包**
