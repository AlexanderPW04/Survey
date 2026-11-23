import { useState } from 'react'
import { adminSurvey, dateLabel } from './api'
import type { Question, ResponseDetail, Results, Summary } from './models'
import { StateError, Status, useData } from './Ui'

const formatNumber = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 12 })
const numberText = (value: number | null | undefined, unit: string) =>
  value == null ? '—' : formatNumber.format(value) + (unit ? ' ' + unit : '')

function AnswerValue({ value, question }: { value: ResponseDetail['items'][number]['value']; question: Question }) {
  if (value === null) return <span className="muted">No answer</span>
  if (Array.isArray(value)) return <ul className="answer-list">{value.map((item, index) => <li key={index}>{item}</li>)}</ul>
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return numberText(value, question.unit)
  return value
}

function ResponseInfo({ surveyId, responseId, dismiss }: { surveyId: string; responseId: string; dismiss: () => void }) {
  const { data, error, retry } = useData<ResponseDetail>('/admin/surveys/' + surveyId + '/responses/' + responseId)
  return <section className="card response-detail" aria-label="Selected response">
    <div className="section-header">
      <div><h2>Response details</h2>{data && <p className="meta">{dateLabel(data.submitted_at)} · Version {data.version.number}</p>}</div>
      <button className="button compact-button" onClick={dismiss}>Hide details</button>
    </div>
    {error ? <><p role="alert">{error}</p><button className="button" onClick={retry}>Try again</button></> :
      data ? <dl className="answer-detail">{data.items.map(item => <div key={item.question.id}>
        <dt>{item.question.label}</dt><dd><AnswerValue value={item.value} question={item.question} /></dd>
      </div>)}</dl> : <p role="status">Loading response…</p>}
  </section>
}

function QuestionSummary({ question, summary }: { question: Question; summary: Summary }) {
  const bars = summary.choices
  const max = Math.max(1, ...(bars || []).map(item => item.count))
  return <article className="card summary-card">
    <h3>{question.label}</h3>
    <p className="meta">{summary.count} answered · {summary.missing} missing</p>
    {bars && <>
      {question.type === 'multiple' && <p className="meta">Number of respondents selecting each option.</p>}
      <ul className="bars">{bars.map(item => <li key={item.label}>
        <span>{item.label}</span>
        <meter aria-hidden="true" min={0} max={max} value={item.count} />
        <strong>{item.count}</strong>
      </li>)}</ul>
    </>}
    {summary.mean !== undefined && <dl className="numeric-summary">
      <div><dt>Minimum</dt><dd>{numberText(summary.minimum, question.unit)}</dd></div>
      <div><dt>Maximum</dt><dd>{numberText(summary.maximum, question.unit)}</dd></div>
      <div><dt>Mean</dt><dd>{numberText(summary.mean, question.unit)}</dd></div>
    </dl>}
    {!bars && summary.mean === undefined && <p className="meta">Open a response to read its answer.</p>}
  </article>
}

function VersionResults({ id, versionId, page, selectVersion, selectPage }: {
  id: string; versionId: string; page: number; selectVersion: (id: string) => void; selectPage: (page: number) => void
}) {
  const root = '/admin/surveys/' + encodeURIComponent(id)
  const query = new URLSearchParams({ page: String(page) })
  if (versionId) query.set('version_id', versionId)
  const { data, error, retry } = useData<Results>(root + '/results?' + query)
  const [responseId, selectResponse] = useState('')
  if (error) return <StateError error={error} retry={retry} />
  if (!data) return <p role="status">Loading responses…</p>
  const version = data.version
  const byId = new Map(data.summaries.map(summary => [summary.id, summary]))
  const count = data.survey.response_count
  const pages = Math.max(1, Math.ceil(data.version_total / data.page_size))
  const exportQuery = version ? '?version_id=' + encodeURIComponent(version.id) : ''

  return <>
    <div className="page-header">
      <div>
        <div className="row-title"><h1>Responses</h1><Status value={data.survey.status} /></div>
        <p>{data.survey.title}</p>
      </div>
      <a className="button" href={adminSurvey(id) + '/edit'}>Edit survey</a>
    </div>
    <section className="card results-toolbar">
      <div className="total"><span>Total responses</span><strong>{count}</strong></div>
      {version && <>
        <label className="version-select" htmlFor="results-version">Published version
          <select id="results-version" value={version.id} onChange={event => selectVersion(event.target.value)}>
            {data.versions.map((item, index) => <option key={item.id} value={item.id}>
              Version {item.number}{index === 0 ? ' (latest)' : ''}
            </option>)}
          </select>
        </label>
        <div className="row-actions">
          <a className="button primary" href={'/api' + root + '/exports/responses.csv' + exportQuery}>Download CSV</a>
          <a className="button" href={'/api' + root + '/exports/codebook.csv' + exportQuery}>Download codebook</a>
        </div>
      </>}
    </section>
    {version ? <>
      <div className="section-header"><h2>Version {version.number} responses</h2><span className="meta">{data.version_total} saved</span></div>
      {data.version_total > 0 ? <div className="card table-card">
        <table>
          <thead><tr><th scope="col">Response ID</th><th scope="col">Submitted</th><th scope="col">Details</th></tr></thead>
          <tbody>{data.responses.map(response => <tr key={response.id}>
            <td><span title={response.id}>{response.id.slice(0, 8)}</span></td>
            <td>{dateLabel(response.submitted_at)}</td>
            <td><button className="button quiet compact-button" onClick={() => selectResponse(response.id)}>Open response</button></td>
          </tr>)}</tbody>
        </table>
        <div className="pagination">
          <button className="button compact-button" disabled={page <= 1} onClick={() => selectPage(page - 1)}>Previous</button>
          <span>Page {page} of {pages}</span>
          <button className="button compact-button" disabled={page >= pages} onClick={() => selectPage(page + 1)}>Next</button>
        </div>
      </div> : <div className="card empty-card"><h3>No responses yet</h3><p>Submitted responses for this version will appear here.</p></div>}
      {responseId && <ResponseInfo key={responseId} surveyId={id} responseId={responseId} dismiss={() => selectResponse('')} />}
      {data.version_total > 0 && <>
        <div className="section-header"><h2>Question summaries</h2></div>
        <div className="summary-grid">{version.definition.questions.map(question => {
          const summary = byId.get(question.id)
          return summary && <QuestionSummary key={question.id} question={question} summary={summary} />
        })}</div>
      </>}
    </> : <section className="card empty-card"><h2>No published versions</h2><p>Publish this survey to start collecting responses.</p></section>}
  </>
}

export function ResultsPage({ id }: { id: string }) {
  const [versionId, setVersion] = useState('')
  const [page, setPage] = useState(1)
  return <>
    <a className="back-link" href="/admin">← Surveys</a>
    <VersionResults key={versionId + ':' + page} id={id} versionId={versionId} page={page}
      selectVersion={id => { setVersion(id); setPage(1) }} selectPage={setPage} />
  </>
}
