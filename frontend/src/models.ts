export const questionTypes = {
  short: { label: 'Short text', group: 'text' },
  long: { label: 'Long text', group: 'text' },
  single: { label: 'Single choice', group: 'choice' },
  dropdown: { label: 'Dropdown', group: 'choice' },
  multiple: { label: 'Multiple choice', group: 'choice' },
  yesno: { label: 'Yes or no', group: 'boolean' },
  integer: { label: 'Whole number', group: 'number' },
  decimal: { label: 'Decimal number', group: 'number' },
  date: { label: 'Date', group: 'date' },
  section: { label: 'Section heading', group: 'section' },
} as const

export type Kind = keyof typeof questionTypes
export type Option = { id: string; label: string }
export type Question = {
  id: string
  key: string
  type: Kind
  label: string
  help: string
  required: boolean
  options: Option[]
  other: boolean
  unit: string
  min: number | null
  max: number | null
}
export type Definition = { title: string; description: string; questions: Question[] }
export type Survey = {
  id: string
  slug: string
  title: string
  status: 'draft' | 'live' | 'closed'
  is_demo: boolean
  updated_at: string
  current_version_id: string | null
}
export type ListedSurvey = Survey & { response_count: number }
export type Draft = Survey & { revision: number; definition: Definition }
export type PublishedSurvey = { version_id: string; definition: Definition }
export type Version = { id: string; number: number; published_at: string }
export type ResponseRow = { id: string; submitted_at: string }
export type Summary = {
  id: string
  count: number
  missing: number
  choices?: { label: string; count: number }[]
  minimum?: number | null
  maximum?: number | null
  mean?: number | null
}
export type Results = {
  survey: ListedSurvey
  versions: Version[]
  version: (Version & { definition: Definition }) | null
  responses: ResponseRow[]
  summaries: Summary[]
  version_total: number
  page: number
  page_size: number
}
export type ResponseDetail = ResponseRow & {
  version: Version
  items: { question: Question; value: string | number | boolean | string[] | null }[]
}
export type Errors = Record<string, string>
export type Choice = string | { other: string }
export type InputValue = string | boolean | Choice[] | { other: string }
export type Inputs = Partial<Record<string, InputValue>>
export type Answers = Record<string, InputValue | number>

export const otherId = '__other__'
export const numberLimit = 1_000_000_000_000
export const isChoice = (kind: Kind) => questionTypes[kind].group === 'choice'
export const isNumber = (kind: Kind) => questionTypes[kind].group === 'number'
export const choiceId = (choice: Choice) => typeof choice === 'string' ? choice : otherId

export function newOption(label = ''): Option {
  return { id: crypto.randomUUID(), label }
}

export function newQuestion(type: Kind): Question {
  const id = crypto.randomUUID()
  return {
    id, key: 'q_' + id.replaceAll('-', ''), type, label: '', help: '', required: false,
    options: isChoice(type) ? [newOption(), newOption()] : [],
    other: false, unit: '', min: null, max: null,
  }
}

export function validateInputs(definition: Definition, inputs: Inputs) {
  const errors: Errors = {}
  const answers: Answers = {}
  for (const q of definition.questions) {
    if (q.type === 'section') continue
    const value = inputs[q.id]
    if (value === undefined || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && !value.length)) {
      if (q.required) errors[q.id] = isChoice(q.type) ? 'Choose an option.' : 'Answer this question.'
      continue
    }
    if (isNumber(q.type)) {
      const raw = typeof value === 'string' ? value.trim() : ''
      const number = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw) ? Number(raw) : NaN
      if (!Number.isFinite(number) || Math.abs(number) > numberLimit || (q.type === 'integer' && !Number.isInteger(number))) {
        errors[q.id] = q.type === 'integer' ? 'Enter a whole number.' : 'Enter a valid number.'
        continue
      }
      if (q.min !== null && number < q.min) {
        errors[q.id] = 'Enter a value of ' + q.min + ' or more.'
        continue
      }
      if (q.max !== null && number > q.max) {
        errors[q.id] = 'Enter a value of ' + q.max + ' or less.'
        continue
      }
      answers[q.id] = number
      continue
    }
    if (isChoice(q.type)) {
      if ((q.type === 'multiple') !== Array.isArray(value)) {
        errors[q.id] = 'Choose an option.'
        continue
      }
      const selected = Array.isArray(value) ? value : [value]
      const ids = new Set(q.options.map(option => option.id))
      if (selected.some(item => typeof item === 'object'
        ? !q.other || typeof item.other !== 'string' || !item.other.trim() || [...item.other.trim()].length > 500
        : typeof item !== 'string' || !ids.has(item))) {
        errors[q.id] = 'Choose an option and fill in Other if selected.'
        continue
      }
    } else if (q.type === 'yesno' && typeof value !== 'boolean') {
      errors[q.id] = 'Choose Yes or No.'
      continue
    } else if (q.type === 'date') {
      const date = typeof value === 'string' && /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T00:00:00Z') : null
      if (!date || !Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
        errors[q.id] = 'Enter a valid date.'
        continue
      }
    } else if (q.type === 'short' || q.type === 'long') {
      const max = q.type === 'short' ? 300 : 3000
      if (typeof value !== 'string' || [...value.trim()].length > max) {
        errors[q.id] = 'Enter text of ' + max + ' characters or fewer.'
        continue
      }
    }
    answers[q.id] = value
  }
  return { answers, errors }
}
