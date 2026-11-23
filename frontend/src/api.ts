import type { Errors } from './models'

export class ApiError extends Error {
  constructor(public status: number, message: string, public fields: Errors = {}) {
    super(message)
  }
}

export async function api<T>(path: string, options: RequestInit = {}, csrf?: string): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body) headers.set('Content-Type', 'application/json')
  if (csrf) headers.set('X-CSRF-Token', csrf)
  const response = await fetch('/api' + path, { ...options, headers, credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const detail = body?.detail
    throw new ApiError(response.status, typeof detail === 'string' ? detail : detail?.message || 'Something went wrong. Try again.', detail?.fields)
  }
  return response.status === 204 ? undefined as T : await response.json() as T
}

export function send(method: string, body?: unknown): RequestInit {
  return { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }
}

export const messageOf = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Could not reach the survey app. Try again.'

export const adminSurvey = (id: string) => '/admin/surveys/' + encodeURIComponent(id)
export const surveyPath = (slug: string) => '/s/' + encodeURIComponent(slug)

export async function copyLink(slug: string) {
  const url = window.location.origin + surveyPath(slug)
  try {
    await navigator.clipboard.writeText(url)
    return 'Participant link copied.'
  } catch {
    window.prompt('Copy this participant link.', url)
    return ''
  }
}

export function dateLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}
