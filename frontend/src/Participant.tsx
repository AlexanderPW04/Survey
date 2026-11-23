import { useEffect, useState } from 'react'
import { api, ApiError, messageOf, send } from './api'
import type { Answers, Inputs, PublishedSurvey } from './models'
import { SurveyForm } from './SurveyForm'

type Attempt = { key: string; inputs: Inputs }

function readAttempt(storageKey: string): Attempt {
  try {
    const saved = sessionStorage.getItem(storageKey)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (typeof parsed.key === 'string' && parsed.inputs && typeof parsed.inputs === 'object') return parsed
    }
  } catch {
    // Storage may be unavailable in this browser.
  }
  return { key: crypto.randomUUID(), inputs: {} }
}

function ActiveSurvey({ slug, survey }: { slug: string; survey: PublishedSurvey }) {
  const storageKey = 'dust-survey:' + slug + ':' + survey.version_id
  const [attempt, setAttempt] = useState(() => readAttempt(storageKey))
  const [saved, setSaved] = useState(false)

  function change(value: Attempt) {
    setAttempt(value)
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(value))
    } catch {
      // The form still works without tab recovery.
    }
  }

  async function submit(answers: Answers) {
    change(attempt)
    const response = await api<{ saved: boolean }>('/public/surveys/' + encodeURIComponent(slug) + '/responses', send('POST', {
      version_id: survey.version_id, submission_key: attempt.key, answers,
    }))
    if (!response.saved) throw new ApiError(500, 'Your response could not be confirmed. Try again.')
    try {
      sessionStorage.removeItem(storageKey)
    } catch {
      // The server already confirmed the response.
    }
    setAttempt({ key: crypto.randomUUID(), inputs: {} })
    setSaved(true)
  }

  if (saved) return <section className="state-panel" role="status">
    <h1>Your response has been saved</h1>
    <p>Thank you for completing the survey.</p>
  </section>

  return <SurveyForm definition={survey.definition} inputs={attempt.inputs} onInput={inputs => change({ ...attempt, inputs })}
    onReset={() => change({ key: crypto.randomUUID(), inputs: {} })} onSubmit={submit} />
}

export function Participant({ slug }: { slug: string }) {
  const [survey, setSurvey] = useState<PublishedSurvey>()
  const [failure, setFailure] = useState<{ status: number; message: string }>()
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    api<PublishedSurvey>('/public/surveys/' + encodeURIComponent(slug), { signal: controller.signal }).then(setSurvey).catch(err => {
      if (!controller.signal.aborted) setFailure({ status: err instanceof ApiError ? err.status : 0, message: messageOf(err) })
    })
    return () => controller.abort()
  }, [slug, retry])

  return <main className="participant">
    {failure ? <section className="state-panel">
      <h1>{failure.status === 410 ? 'This survey is closed' : 'Survey unavailable'}</h1>
      {failure.status === 410 ? <p>This survey is no longer collecting responses.</p> :
        failure.status === 404 ? <p>Check the link you were given and try again.</p> : <>
          <p>{failure.message}</p>
          <button className="button" onClick={() => { setFailure(undefined); setRetry(retry + 1) }}>Try again</button>
        </>}
    </section> : survey ? <ActiveSurvey slug={slug} survey={survey} /> : <p role="status">Loading survey…</p>}
  </main>
}
