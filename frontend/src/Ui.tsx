import { useEffect, useState } from 'react'
import { api, messageOf } from './api'
import type { Survey } from './models'

export function StateError({ error, retry }: { error: string; retry?: () => void }) {
  return <section className="state-panel">
    <h1>Something went wrong</h1><p>{error}</p>
    {retry && <button className="button" onClick={retry}>Try again</button>}
  </section>
}

export function Status({ value }: { value: Survey['status'] }) {
  return <span className={'status status-' + value}>{value[0].toUpperCase() + value.slice(1)}</span>
}

export function useData<T>(path: string) {
  const [data, setData] = useState<T>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    api<T>(path, { signal: controller.signal }).then(setData).catch(err => {
      if (!controller.signal.aborted) setError(messageOf(err))
    })
    return () => controller.abort()
  }, [path, attempt])
  return { data, error, retry: () => { setError(''); setAttempt(value => value + 1) } }
}
