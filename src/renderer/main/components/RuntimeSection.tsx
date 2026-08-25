import { useEffect, useState } from 'react'
import type { ConfigViewV1 } from '@echocue/contracts'
import { useAsyncAction } from '../hooks/useAsyncAction'
import {
  runtimeFormFromConfig,
  validateRuntimeForm,
  type RuntimeForm,
} from '../system/runtime-settings'

const DEFAULT_DATA_DIR_HINT = '系统数据保存位置（默认 %LOCALAPPDATA%\\Echocue，可在本页更改）'

// 系统设置页「运行机制」卡片：弹幕排队、审计保留期、/metrics 端口。
export default function RuntimeSection() {
  const [config, setConfig] = useState<ConfigViewV1 | null>(null)
  const [form, setForm] = useState<RuntimeForm | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  // WP-5: in-app data-root relocation target + status + effective data root.
  const [targetDir, setTargetDir] = useState('')
  const [moveMessage, setMoveMessage] = useState<string | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [dataRoot, setDataRoot] = useState<string | null>(null)

  const load = useAsyncAction(async () => {
    const view = await window.echocue.config.get()
    setConfig(view)
    setForm(runtimeFormFromConfig(view))
    // Show where audit/settings/qdrant actually live (mirrors the boot pointer).
    setDataRoot(await window.echocue.config.getDataRoot())
    setMessage(null)
    setFieldError(null)
    return true
  })

  useEffect(() => {
    void load.run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const moveAction = useAsyncAction(async (targetDir: string) => {
    setMoveMessage(null)
    setMoveError(null)
    try {
      // On success the main process relaunches the app; the renderer rarely gets
      // a response back, but the IPC resolves before quit on non-relaunch paths.
      await window.echocue.config.moveDataRoot(targetDir)
      setMoveMessage('数据已迁移，应用即将重启')
      return true
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : String(err))
      return false
    }
  })

  const save = useAsyncAction(async () => {
    if (form === null || config === null) return false
    // When queueing is disabled the greyed-out timeout field is not validated;
    // persist the last stored value so the contract stays satisfied.
    const validation = validateRuntimeForm(form, config.queueing.timeoutMs / 1000)
    if (!validation.ok) {
      setFieldError(validation.message)
      setMessage(null)
      return false
    }
    const updated = await window.echocue.config.update(validation.update)
    setConfig(updated)
    setForm(runtimeFormFromConfig(updated))
    setFieldError(null)
    setMessage('已保存；排队与保留期在下次启动服务时生效，metrics 端口在重启应用后生效')
    return true
  })

  if (config === null || form === null) {
    return load.error ? (
      <p className="danger-text">{load.error}</p>
    ) : (
      <p className="muted">正在读取运行机制配置…</p>
    )
  }

  const setField = <K extends keyof RuntimeForm>(key: K, value: RuntimeForm[K]) => {
    setForm((current) => (current === null ? current : { ...current, [key]: value }))
    setFieldError(null)
  }

  return (
    <>
      <div className="card">
        <h2>弹幕排队</h2>
        <p>浮窗展示期间到达的弹幕按 FIFO 排队，展示结束后补发处理；超时未处理的弹幕丢弃并记入审计。</p>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.queueingEnabled}
            onChange={(e) => setField('queueingEnabled', e.target.checked)}
          />
          展示期间排队补发（默认关闭：到达即丢弃）
        </label>
        <label>
          排队超时（秒，1–120）
          <input
            type="number"
            min="1"
            max="120"
            step="1"
            value={form.queueTimeoutSec}
            disabled={!form.queueingEnabled}
            onChange={(e) => setField('queueTimeoutSec', e.target.value)}
          />
        </label>
      </div>

      <div className="card">
        <h2>数据与保留</h2>
        <label>
          审计回放保留天数（7–180，默认 30）
          <input
            type="number"
            min="7"
            max="180"
            step="1"
            value={form.retentionDays}
            onChange={(e) => setField('retentionDays', e.target.value)}
          />
        </label>
        <p>超过保留期的完整回放记录在当天首次启动应用时自动清理；不影响进行中的记录。</p>
      </div>

      <div className="card">
        <h2>数据保存位置</h2>
        <p>{DEFAULT_DATA_DIR_HINT}。迁移需要停止服务，复制完成后应用自动重启。</p>
        {dataRoot ? <p className="muted">当前数据目录：{dataRoot}</p> : null}
        <label>
          新数据目录（绝对路径）
          <input
            type="text"
            value={targetDir}
            placeholder="D:\EchocueData"
            onChange={(e) => {
              setTargetDir(e.target.value)
              setMoveError(null)
            }}
          />
        </label>
        {moveError ? <p className="danger-text">{moveError}</p> : null}
        {moveMessage ? <p className="inline-message">{moveMessage}</p> : null}
        <div className="button-row">
          <button
            type="button"
            className="secondary"
            disabled={targetDir.trim() === ''}
            onClick={() => void moveAction.run(targetDir.trim())}
          >
            {moveAction.running ? '正在迁移…' : '更改数据保存位置'}
          </button>
        </div>
      </div>

      <div className="card">
        <h2>监控端点</h2>
        <label>
          /metrics 端口（1024–65535，默认 9100）
          <input
            type="number"
            min="1024"
            max="65535"
            step="1"
            value={form.metricsPort}
            onChange={(e) => setField('metricsPort', e.target.value)}
          />
        </label>
        <p>仅本机回环地址可访问；重启应用后生效。</p>
      </div>

      {fieldError ? <p className="danger-text">{fieldError}</p> : null}
      {message ? <p className="inline-message">{message}</p> : null}
      {save.error ? <p className="danger-text">{save.error}</p> : null}
      <div className="button-row">
        <button type="button" disabled={save.running || load.running} onClick={() => void save.run()}>
          {save.running ? '正在保存…' : '保存运行机制'}
        </button>
      </div>
    </>
  )
}
