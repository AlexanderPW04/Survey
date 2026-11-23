import { useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { adminSurvey, api, ApiError, copyLink, messageOf, send } from './api'
import { Status } from './Ui'
import { SurveyForm } from './SurveyForm'
import { isChoice, isNumber, newOption, newQuestion, numberLimit, questionTypes } from './models'
import type { Definition, Draft, Errors, Inputs, Kind, Question } from './models'

const typeDrag = 'application/x-dust-question-type'
const cardDrag = 'application/x-dust-question-id'

function moved<T>(items: T[], from: number, to: number) {
  const updated = [...items]
  const [item] = updated.splice(from, 1)
  updated.splice(to, 0, item)
  return updated
}

function Preview({ definition, csrf, onClose }: { definition: Definition; csrf: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [inputs, setInputs] = useState<Inputs>({})
  const [passed, setPassed] = useState(false)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className="preview-dialog" onClose={onClose} aria-labelledby="preview-title">
    <div className="dialog-bar"><strong id="preview-title">Survey preview</strong><button type="button" className="button" onClick={() => dialog.current?.close()}>Close preview</button></div>
    <div className="preview-content">
      {passed ? <div className="state-panel" role="status">
        <h2>Preview complete</h2><p>These answers were only used to test the form.</p>
        <button className="button" onClick={() => { setPassed(false); setInputs({}) }}>Try again</button>
      </div> : <SurveyForm definition={definition} inputs={inputs} onInput={setInputs} preview onReset={() => setInputs({})}
        onSubmit={async answers => { await api<void>('/admin/preview', send('POST', { definition, answers }), csrf); setPassed(true) }} />}
    </div>
  </dialog>
}

export function Editor({ initial, csrf, onDirty }: { initial: Draft; csrf: string; onDirty: (dirty: boolean) => void }) {
  const [saved, setSaved] = useState(initial)
  const [definition, setDefinition] = useState(initial.definition)
  const [selectedId, setSelectedId] = useState(initial.definition.questions[0]?.id || '')
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [fields, setFields] = useState<Errors>({})
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const working = useRef(false)
  const leaving = useRef(false)
  const current = definition.questions.find(q => q.id === selectedId)
  const dirty = JSON.stringify(saved.definition) !== JSON.stringify(definition)
  const endpoint = '/admin/surveys/' + saved.id

  useEffect(() => {
    onDirty(dirty)
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      if (leaving.current) return
      event.preventDefault()
      event.returnValue = true
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, onDirty])

  function replaceQuestions(questions: Question[]) {
    setDefinition({ ...definition, questions })
  }

  function add(type: Kind, position = definition.questions.length) {
    if (definition.questions.length >= 60) return
    const question = newQuestion(type)
    const ordered = [...definition.questions]
    ordered.splice(position, 0, question)
    replaceQuestions(ordered)
    setSelectedId(question.id)
  }

  function changeQuestion(changes: Partial<Question>) {
    replaceQuestions(definition.questions.map(q => q.id === selectedId ? { ...q, ...changes } : q))
    if (fields[selectedId]) setFields({ ...fields, [selectedId]: '' })
  }

  function removeQuestion() {
    const position = definition.questions.findIndex(q => q.id === selectedId)
    const remaining = definition.questions.filter(q => q.id !== selectedId)
    replaceQuestions(remaining)
    setSelectedId(remaining[Math.min(position, remaining.length - 1)]?.id || '')
  }

  function dragOver(event: DragEvent, index: number) {
    const types = event.dataTransfer.types
    if (!types.includes(typeDrag) && !types.includes(cardDrag)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = types.includes(cardDrag) ? 'move' : 'copy'
    setDropIndex(index)
  }

  function drop(event: DragEvent, index: number) {
    event.preventDefault()
    event.stopPropagation()
    setDropIndex(null)
    if (working.current) return
    const type = event.dataTransfer.getData(typeDrag)
    if (Object.hasOwn(questionTypes, type)) {
      add(type as Kind, index)
      return
    }
    const draggedId = event.dataTransfer.getData(cardDrag)
    const from = definition.questions.findIndex(q => q.id === draggedId)
    if (from >= 0) replaceQuestions(moved(definition.questions, from, index > from ? index - 1 : index))
  }

  async function action(name: 'save' | 'publish' | 'close' | 'delete') {
    if (working.current) return
    if (name === 'close' && !window.confirm('Close this survey to new responses?')) return
    if (name === 'delete' && !window.confirm('Permanently delete this unused draft?')) return
    working.current = true
    setBusy(name)
    setNotice('')
    setError('')
    setFields({})
    try {
      let latest = saved
      if ((name === 'save' || name === 'publish') && dirty) {
        latest = await api<Draft>(endpoint, send('PUT', { revision: latest.revision, definition }), csrf)
        setSaved(latest)
        setDefinition(latest.definition)
      }
      if (name === 'publish' || name === 'close') {
        latest = await api<Draft>(endpoint + '/' + name, send('POST', { revision: latest.revision }), csrf)
        setSaved(latest)
      }
      if (name === 'delete') {
        await api<void>(endpoint, send('DELETE', { revision: latest.revision }), csrf)
        leaving.current = true
        window.location.assign('/admin')
      }
      setNotice(name === 'publish' ? 'Survey published. You can now copy the participant link.' :
        name === 'close' ? 'Survey closed.' : 'Draft saved.')
    } catch (err) {
      setError(messageOf(err))
      if (err instanceof ApiError) {
        setFields(err.fields)
        const item = definition.questions.find(q => Object.hasOwn(err.fields, q.id))
        if (item) setSelectedId(item.id)
      }
    } finally {
      working.current = false
      setBusy('')
    }
  }

  return <>
    <a className="back-link" href="/admin">← Surveys</a>
    <div className="page-header builder-header">
      <div>
        <div className="row-title"><h1>Survey builder</h1><Status value={saved.status} /></div>
        <p>{dirty ? 'Unsaved changes' : 'All changes saved'}{saved.is_demo ? ' · Demonstration template' : ''}</p>
      </div>
      <div className="row-actions">
        <a className="button quiet" href={adminSurvey(saved.id) + '/results'}>Responses</a>
        <button className="button" disabled={!!busy} onClick={() => setPreview(true)}>Preview</button>
        <button className="button" disabled={!!busy || !dirty} onClick={() => void action('save')}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
        <button className="button primary" disabled={!!busy} onClick={() => void action('publish')}>{busy === 'publish' ? 'Publishing…' : 'Publish'}</button>
      </div>
    </div>
    {saved.is_demo && <p className="demo-note template-notice">Placeholder questions for testing. Use the builder to replace them with your study questions.</p>}
    {notice && <div className="notice" role="status">{notice}</div>}
    {error && <div className="notice error" role="alert">{error}{fields.questions && ' ' + fields.questions}</div>}
    <fieldset className="editor-grid" disabled={!!busy}>
      <aside className="card palette">
        <h2>Add question</h2>
        <div className="palette-list">
          {(Object.keys(questionTypes) as Kind[]).map(type => <button type="button" className="palette-item" key={type}
            draggable={!busy} onDragStart={event => {
              event.dataTransfer.setData(typeDrag, type)
              event.dataTransfer.effectAllowed = 'copy'
            }} onDragEnd={() => setDropIndex(null)} disabled={definition.questions.length >= 60}
            onClick={() => add(type)}><span aria-hidden="true">+</span>{questionTypes[type].label}</button>)}
        </div>
      </aside>
      <div className="editor-canvas">
        <section className="card survey-details">
          <label htmlFor="survey-title">Survey name</label>
          <input id="survey-title" value={definition.title} maxLength={160} onChange={e => setDefinition({ ...definition, title: e.target.value })} />
          {fields.title && <p className="field-error">{fields.title}</p>}
          <label htmlFor="survey-intro">Introduction <span className="muted">(optional)</span></label>
          <textarea id="survey-intro" rows={2} value={definition.description} maxLength={2000}
            onChange={e => setDefinition({ ...definition, description: e.target.value })} />
        </section>
        <section className="question-canvas" aria-label="Survey questions" onDragLeave={event => {
          const next = event.relatedTarget
          if (!(next instanceof Node) || !event.currentTarget.contains(next)) setDropIndex(null)
        }}>
          <h2>Questions <span className="muted">({definition.questions.length})</span></h2>
          {definition.questions.map((q, index) => <div key={q.id}>
            <div className={'drop-marker' + (dropIndex === index ? ' target' : '')} />
            <article className={'card question-card' + (selectedId === q.id ? ' selected' : '')}
              onDragOver={event => dragOver(event, index + (event.clientY >= event.currentTarget.getBoundingClientRect().top + event.currentTarget.offsetHeight / 2 ? 1 : 0))}
              onDrop={event => drop(event, index + (event.clientY >= event.currentTarget.getBoundingClientRect().top + event.currentTarget.offsetHeight / 2 ? 1 : 0))}>
              <span className="drag-grip" draggable={!busy} title="Drag to move" aria-hidden="true" onDragStart={event => {
                event.dataTransfer.setData(cardDrag, q.id)
                event.dataTransfer.effectAllowed = 'move'
                setSelectedId(q.id)
              }} onDragEnd={() => setDropIndex(null)}>⠿</span>
              <button type="button" className="question-select" aria-pressed={selectedId === q.id} onClick={() => setSelectedId(q.id)}>
                <strong>{q.label || (q.type === 'section' && q.help) || 'Untitled question'}</strong><span>{questionTypes[q.type].label}{q.required ? ' · Required' : ''}</span>
              </button>
              <div className="move-buttons">
                <button className="move" type="button" aria-label={'Move up: ' + (q.label || 'Question ' + (index + 1))}
                  title="Move up" disabled={index === 0} onClick={() => replaceQuestions(moved(definition.questions, index, index - 1))}>↑</button>
                <button className="move" type="button" aria-label={'Move down: ' + (q.label || 'Question ' + (index + 1))}
                  title="Move down" disabled={index === definition.questions.length - 1}
                  onClick={() => replaceQuestions(moved(definition.questions, index, index + 1))}>↓</button>
              </div>
            </article>
          </div>)}
          <div className={'drop-marker' + (dropIndex === definition.questions.length ? ' target' : '')} />
          <div className="drop-zone" onDragOver={event => dragOver(event, definition.questions.length)}
            onDrop={event => drop(event, definition.questions.length)}>
            {definition.questions.length ? 'Drop a question here' : 'Choose a question type or drop it here.'}
          </div>
        </section>
      </div>
      <aside className="card settings">
        <h2>Question settings</h2>
        {current ? <QuestionSettings key={current.id} question={current} error={fields[current.id]} change={changeQuestion} remove={removeQuestion} /> :
          <p className="muted">Add or select a question to edit it.</p>}
      </aside>
    </fieldset>
    <div className="editor-footer">
      {saved.status !== 'draft' && <button className="button" disabled={!!busy} onClick={() => void copyLink(saved.slug).then(setNotice)}>Copy link</button>}
      {saved.status === 'live' && <button className="button quiet" disabled={!!busy} onClick={() => void action('close')}>Close survey</button>}
      {saved.status === 'draft' && !saved.is_demo && <button className="button quiet danger" disabled={!!busy} onClick={() => void action('delete')}>Delete draft</button>}
    </div>
    {preview && <Preview definition={definition} csrf={csrf} onClose={() => setPreview(false)} />}
  </>
}

function QuestionSettings({ question: q, error, change, remove }: {
  question: Question; error?: string; change: (data: Partial<Question>) => void; remove: () => void
}) {
  return <div className="settings-fields">
    <p className="type-label">{questionTypes[q.type].label}</p>
    <label htmlFor="question-wording">{q.type === 'section' ? 'Section heading' : 'Question wording'}</label>
    <input id="question-wording" value={q.label} maxLength={240} onChange={event => change({ label: event.target.value })} />
    <label htmlFor="question-help">Help text <span className="muted">(optional)</span></label>
    <textarea id="question-help" rows={2} value={q.help} maxLength={500} onChange={event => change({ help: event.target.value })} />
    {q.type !== 'section' && <label className="toggle-row"><input type="checkbox" checked={q.required}
      onChange={event => change({ required: event.target.checked })} /> Required</label>}
    {isChoice(q.type) && <div className="setting-group">
      <h3>Choices</h3>
      {q.options.map((option, index) => <div className="option-settings" key={option.id}>
        <label className="sr-only" htmlFor={'option-' + option.id}>Choice {index + 1}</label>
        <input id={'option-' + option.id} maxLength={160} placeholder={'Choice ' + (index + 1)} value={option.label}
          onChange={event => change({ options: q.options.map(item => item.id === option.id ? { ...item, label: event.target.value } : item) })} />
        <div className="move-buttons">
          <button type="button" className="move" title="Move choice up" aria-label={'Move choice ' + (index + 1) + ' up'}
            disabled={index === 0} onClick={() => change({ options: moved(q.options, index, index - 1) })}>↑</button>
          <button type="button" className="move" title="Move choice down" aria-label={'Move choice ' + (index + 1) + ' down'}
            disabled={index === q.options.length - 1} onClick={() => change({ options: moved(q.options, index, index + 1) })}>↓</button>
          <button type="button" className="move danger" title="Remove choice" aria-label={'Remove choice ' + (index + 1)}
            onClick={() => change({ options: q.options.filter(item => item.id !== option.id) })}>×</button>
        </div>
      </div>)}
      <button type="button" className="button compact-button" disabled={q.options.length >= 30}
        onClick={() => change({ options: [...q.options, newOption()] })}>Add choice</button>
      <label className="toggle-row"><input type="checkbox" checked={q.other} onChange={event => change({ other: event.target.checked })} /> Allow “Other”</label>
    </div>}
    {isNumber(q.type) && <div className="setting-group">
      <label htmlFor="question-unit">Unit <span className="muted">(optional)</span></label>
      <input id="question-unit" maxLength={40} value={q.unit} onChange={event => change({ unit: event.target.value })} />
      <div className="limit-settings">
        {(['min', 'max'] as const).map(bound => <label key={bound} htmlFor={'question-' + bound}>
          {bound === 'min' ? 'Minimum' : 'Maximum'}
          <input id={'question-' + bound} type="number" min={-numberLimit} max={numberLimit}
            step={q.type === 'integer' ? 1 : 'any'} value={q[bound] ?? ''}
            onChange={event => change({ [bound]: Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : null })} />
        </label>)}
      </div>
    </div>}
    {error && <p className="field-error" role="alert">{error}</p>}
    <button className="button quiet danger" type="button" onClick={remove}>Remove question</button>
  </div>
}
