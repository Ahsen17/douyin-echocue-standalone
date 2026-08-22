import { useRef, useState } from 'react'

export interface AsyncActionState {
  running: boolean
  error: string | null
}

// Generic async action state: tracks in-flight and surfaces a user-facing
// error without clearing the form on failure.
export function useAsyncAction<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
  const fnRef = useRef(fn)
  fnRef.current = fn
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(...args: A): Promise<boolean> {
    setRunning(true)
    setError(null)
    try {
      await fnRef.current(...args)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败，请重试')
      return false
    } finally {
      setRunning(false)
    }
  }

  return { running, error, run }
}
