import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { adminSurvey, api, ApiError, copyLink, dateLabel, messageOf, send } from './api'
import type { Draft, ListedSurvey } from './models'
import { Editor } from './Editor'
import { StateError, Status, useData } from './Ui'
import { ResultsPage } from './Results'

function AdminShell({ children, onLock }: { children: ReactNode; onLock?: () => Promise<void> }) {
  const [error, setError] = useState('')
  return <div className="admin-layout">
    <header className="site-header">
      <div className="site-header-inner">
        <a href="/admin" className="brand"><span className="brand-mark" aria-hidden="true" />Dust Survey</a>
        {onLock && <button className="button quiet compact-button" onClick={() => void onLock().catch(err => setError(messageOf(err)))}>Lock admin</button>}
      </div>
    </header>
    <main className="admin-main">
      {error && <div className="notice error" role="alert">{error}</div>}
      {children}
    </main>
  </div>
}

function SignIn({ onSuccess }: { onSuccess: (csrf: string) => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function login(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const session = await api<{ csrf: string }>('/admin/session', {
        ...send('POST', { password }), headers: { 'X-Admin-Request': '1' },
      })
      setPassword('')
      onSuccess(session.csrf)
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  return <form className="state-panel login-panel" onSubmit={login}>
    <h1>Admin access</h1>
    <label htmlFor="admin-password">Admin password</label>
    <input id="admin-password" type="password" autoComplete="current-password" required value={password} maxLength={1024}
      onChange={event => setPassword(event.target.value)} />
    {error && <p className="field-error" role="alert">{error}</p>}
    <button className="button primary" disabled={busy}>{busy ? 'Opening…' : 'Open admin'}</button>
  </form>
}

function SurveyList() {
  const { data, error, retry } = useData<ListedSurvey[]>('/admin/surveys')
  const [notice, setNotice] = useState('')
  if (error) return <StateError error={error} retry={retry} />

  return <>
    <div className="page-header">
      <div><h1>Surveys</h1><p>Create surveys and view their responses.</p></div>
      <a className="button primary" href="/admin/surveys/new"><span aria-hidden="true">+</span> New survey</a>
    </div>
    {notice && <div role="status" className="notice">{notice}</div>}
    {!data ? <p role="status">Loading surveys…</p> : data.length === 0 ? <section className="state-panel">
      <h2>No surveys yet</h2><p>Create a survey to get started.</p>
    </section> : <div className="card survey-list">
      {data.map(survey => <article className="survey-row" key={survey.id}>
        <div className="survey-info">
          <div className="row-title"><h2><a href={adminSurvey(survey.id) + '/edit'}>{survey.title}</a></h2><Status value={survey.status} /></div>
          <p className="meta">{survey.response_count} {survey.response_count === 1 ? 'response' : 'responses'} <span aria-hidden="true">·</span> Updated {dateLabel(survey.updated_at)}</p>
          {survey.is_demo && <p className="demo-note">Demonstration template · Placeholder for testing</p>}
        </div>
        <div className="row-actions">
          <a className="button quiet compact-button" href={adminSurvey(survey.id) + '/edit'}>Edit</a>
          {survey.status !== 'draft' && <button className="button compact-button" onClick={() => void copyLink(survey.slug).then(setNotice)}>Copy link</button>}
          <a className="button compact-button" href={adminSurvey(survey.id) + '/results'}>View responses</a>
        </div>
      </article>)}
    </div>}
  </>
}

function NewSurvey({ csrf }: { csrf: string }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function create(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (!title.trim()) { setError('Enter a survey name.'); return }
    setBusy(true)
    setError('')
    try {
      const survey = await api<Draft>('/admin/surveys', send('POST', { title, description, questions: [] }), csrf)
      window.location.assign(adminSurvey(survey.id) + '/edit')
    } catch (err) {
      setError(messageOf(err))
      setBusy(false)
    }
  }

  return <>
    <a className="back-link" href="/admin">← Surveys</a>
    <div className="page-header"><div><h1>New survey</h1></div></div>
    <form className="card new-survey" onSubmit={create}>
      <label htmlFor="new-title">Survey name</label>
      <input id="new-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={160} required />
      <label htmlFor="new-description">Introduction <span className="muted">(optional)</span></label>
      <textarea id="new-description" value={description} onChange={event => setDescription(event.target.value)} maxLength={2000} />
      {error && <p className="field-error" role="alert">{error}</p>}
      <button className="button primary" disabled={busy}>{busy ? 'Creating…' : 'Create survey'}</button>
    </form>
  </>
}

function LoadEditor({ id, csrf, onDirty }: { id: string; csrf: string; onDirty: (dirty: boolean) => void }) {
  const { data, error, retry } = useData<Draft>('/admin/surveys/' + encodeURIComponent(id))
  return error ? <StateError error={error} retry={retry} /> :
    data ? <Editor initial={data} csrf={csrf} onDirty={onDirty} /> : <p role="status">Loading builder…</p>
}

export function Admin({ path }: { path: string }) {
  const [csrf, setCsrf] = useState<string | null>()
  const [error, setError] = useState('')
  const [draftDirty, setDraftDirty] = useState(false)

  function checkSession(signal?: AbortSignal) {
    setError('')
    api<{ csrf: string }>('/admin/session', { signal }).then(result => setCsrf(result.csrf)).catch(err => {
      if (signal?.aborted) return
      if (err instanceof ApiError && err.status === 401) setCsrf(null)
      else setError(messageOf(err))
    })
  }

  useEffect(() => {
    const controller = new AbortController()
    checkSession(controller.signal)
    return () => controller.abort()
  }, [])

  if (!csrf) return <AdminShell>
    {error ? <StateError error={error} retry={() => checkSession()} /> :
      csrf === undefined ? <p role="status">Checking admin access…</p> : <SignIn onSuccess={setCsrf} />}
  </AdminShell>

  async function lock() {
    if (draftDirty && !window.confirm('Leave without saving your changes?')) return
    try {
      await api<void>('/admin/session', send('DELETE'), csrf || undefined)
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 401) throw err
    }
    setDraftDirty(false)
    setCsrf(null)
  }

  const survey = path.match(/^\/admin\/surveys\/([\w-]+)\/(edit|results)$/)
  return <AdminShell onLock={lock}>
    {path === '/admin' ? <SurveyList /> :
      path === '/admin/surveys/new' ? <NewSurvey csrf={csrf} /> :
      survey?.[2] === 'edit' ? <LoadEditor id={survey[1]} csrf={csrf} onDirty={setDraftDirty} /> :
      survey?.[2] === 'results' ? <ResultsPage id={survey[1]} /> :
      <StateError error="This admin page could not be found." />}
  </AdminShell>
}
