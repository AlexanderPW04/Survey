import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, messageOf } from './api'
import { choiceId, isNumber, otherId, validateInputs } from './models'
import type { Answers, Choice, Definition, Errors, Inputs, InputValue, Question } from './models'

type Props = {
  definition: Definition
  inputs: Inputs
  onInput: (inputs: Inputs) => void
  onSubmit: (answers: Answers) => Promise<void>
  onReset: () => void
  preview?: boolean
}

export function SurveyForm({ definition, inputs, onInput, onSubmit, onReset, preview }: Props) {
  const [fields, setFields] = useState<Errors>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const alert = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (error) alert.current?.focus()
  }, [error])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting.current) return
    const checked = validateInputs(definition, inputs)
    setFields(checked.errors)
    setError('')
    if (Object.keys(checked.errors).length) {
      setError('Check the highlighted answers.')
      return
    }
    submitting.current = true
    setBusy(true)
    try {
      await onSubmit(checked.answers)
    } catch (err) {
      setError(messageOf(err))
      if (err instanceof ApiError) setFields(err.fields)
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  return <form className="survey-form" onSubmit={submit} noValidate>
    <header className="survey-heading">
      <h1>{definition.title.trim() || 'Untitled survey'}</h1>
      {definition.description && <p>{definition.description}</p>}
    </header>
    {error && <div ref={alert} tabIndex={-1} className="notice error" role="alert">{error}</div>}
    <fieldset className="form-fields" disabled={busy}>
      {definition.questions.map(question => <QuestionField key={question.id} question={question}
        value={inputs[question.id]} error={fields[question.id]} onChange={value => {
          onInput({ ...inputs, [question.id]: value })
          if (fields[question.id]) setFields({ ...fields, [question.id]: '' })
        }} />)}
      <div className="form-actions">
        <button type="submit" className="button primary">{busy ? 'Saving…' : preview ? 'Test preview' : 'Submit'}</button>
        {Object.values(inputs).some(value => value !== undefined) &&
          <button type="button" className="button quiet" onClick={() => {
            if (!window.confirm('Clear all entered answers?')) return
            setFields({})
            setError('')
            onReset()
          }}>Start over</button>}
      </div>
    </fieldset>
  </form>
}

function QuestionField({ question: q, value, error, onChange }: {
  question: Question; value?: InputValue; error?: string; onChange: (value: InputValue | undefined) => void
}) {
  const id = 'question-' + q.id
  const text = typeof value === 'string' ? value : ''
  const label = q.label || 'Untitled question'
  const described = [q.help && id + '-help', error && id + '-error'].filter(Boolean).join(' ') || undefined
  const a11y = { 'aria-describedby': described, 'aria-invalid': error ? true : undefined, 'aria-required': q.required || undefined }
  const title = <>{label}{q.required && <span className="required"> (required)</span>}</>
  const help = q.help && <p className="help" id={id + '-help'}>{q.help}</p>
  const explanation = error && <p className="field-error" id={id + '-error'}>{error}</p>

  if (q.type === 'section') return <section className="form-section">{q.label.trim() && <h2>{q.label}</h2>}{help}</section>

  if (q.type === 'single' || q.type === 'multiple' || q.type === 'dropdown') {
    const choices = q.other ? [...q.options, { id: otherId, label: 'Other' }] : q.options
    const selected: Choice[] = Array.isArray(value) ? value : value !== undefined && typeof value !== 'boolean' ? [value] : []
    const selectedIds = selected.map(choiceId)
    const other = selected.find(choice => typeof choice === 'object')
    const select = (optionId: string, checked = true) => {
      const choice = optionId === otherId ? { other: '' } : optionId
      onChange(q.type === 'multiple'
        ? checked ? [...selected, choice] : selected.filter(item => choiceId(item) !== optionId)
        : optionId ? choice : undefined)
    }
    const otherField = selectedIds.includes(otherId) && <label className="other-field" htmlFor={id + '-other'}>
      <span>Describe Other</span>
      <input id={id + '-other'} aria-describedby={described} value={typeof other === 'object' ? other.other : ''} maxLength={500}
        onChange={event => onChange(q.type === 'multiple'
          ? selected.map(item => typeof item === 'object' ? { other: event.target.value } : item)
          : { other: event.target.value })} />
    </label>
    if (q.type === 'dropdown') return <div className="form-field">
      <label className="question-label" htmlFor={id}>{title}</label>{help}
      <select id={id} {...a11y} value={selectedIds[0] || ''} onChange={event => select(event.target.value)}>
        <option value="">Choose an option</option>
        {choices.map(option => <option key={option.id} value={option.id}>{option.label || 'Unnamed choice'}</option>)}
      </select>
      {otherField}{explanation}
    </div>
    return <fieldset className="form-field" aria-describedby={described} aria-invalid={error ? true : undefined}>
      <legend>{title}</legend>{help}
      <div className="choice-list">
        {choices.map(option => <label key={option.id} className="choice-row">
          <input type={q.type === 'multiple' ? 'checkbox' : 'radio'} name={id} checked={selectedIds.includes(option.id)}
            onChange={event => select(option.id, event.target.checked)} />{option.label || 'Unnamed choice'}
        </label>)}
      </div>
      {otherField}{explanation}
    </fieldset>
  }

  if (q.type === 'yesno') return <fieldset className="form-field" aria-describedby={described} aria-invalid={error ? true : undefined}>
    <legend>{title}</legend>{help}
    <div className="choice-list compact">
      {[true, false].map(answer => <label key={String(answer)} className="choice-row">
        <input type="radio" name={id} checked={value === answer} onChange={() => onChange(answer)} />
        {answer ? 'Yes' : 'No'}
      </label>)}
    </div>
    {explanation}
  </fieldset>

  return <div className="form-field">
    <label className="question-label" htmlFor={id}>{title}</label>{help}
    {q.type === 'long' ? <textarea id={id} {...a11y} maxLength={3000} value={text} onChange={event => onChange(event.target.value)} /> :
      <div className={q.unit ? 'with-unit' : undefined}>
        <input id={id} {...a11y} aria-describedby={[described, q.unit && id + '-unit'].filter(Boolean).join(' ') || undefined}
          type={q.type === 'date' ? 'date' : 'text'}
          inputMode={isNumber(q.type) ? (q.type === 'integer' && (q.min ?? -1) >= 0 ? 'numeric' : 'decimal') : undefined}
          maxLength={q.type === 'short' ? 300 : isNumber(q.type) ? 32 : undefined}
          value={text} onChange={event => onChange(event.target.value)} />
        {q.unit && <span className="unit" id={id + '-unit'}>{q.unit}</span>}
      </div>}
    {explanation}
  </div>
}
