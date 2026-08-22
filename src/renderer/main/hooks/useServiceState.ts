import { useEffect, useState } from 'react'
import type { ServiceViewState } from '@echocue/contracts'

// Subscribes to the main-process broadcast; renderer never derives lifecycle.
export function useServiceState(): ServiceViewState | null {
  const [state, setState] = useState<ServiceViewState | null>(null)
  useEffect(() => {
    return window.echocue.service.subscribe(setState)
  }, [])
  return state
}
