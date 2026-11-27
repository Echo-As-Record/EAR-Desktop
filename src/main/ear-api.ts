import type { EarPage, EarRecord, Failure, Identity, RecordKind, Result } from '../shared/ear.js'

class EarError extends Error {
  constructor(readonly code: Failure) { super(code) }
}

export function connectionOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/'
      || url.search || url.hash) return null
    return url.origin
  } catch {
    return null
  }
}

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new EarError('invalid_response')
  }
  return value as Record<string, unknown>
}

function time(value: unknown): string | null {
  if (value === null) return null
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return value
  throw new EarError('invalid_response')
}

function record(data: unknown, kind: RecordKind): EarRecord {
  const row = object(data)
  const payload = object(row.payload)
  const text = kind === 'artifact' ? payload.body_md : payload.text
  if (row.data_type !== kind || typeof row.id !== 'string' || !idPattern.test(row.id)
    || typeof text !== 'string') throw new EarError('invalid_response')

  const ids = kind === 'artifact' ? payload.evidence_ids : []
  if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string' && idPattern.test(id))) {
    throw new EarError('invalid_response')
  }

  return { id: row.id, start: time(row.event_start), end: time(row.event_end), text, evidenceIds: ids }
}

type Fetch = typeof fetch

export class EarSession {
  private active: { origin: string; token: string } | null = null
  private lifetime = new AbortController()

  constructor(readonly origin: string | null, private readonly request: Fetch = fetch) {}

  disconnect(): void {
    this.active = null
    this.lifetime.abort()
    this.lifetime = new AbortController()
  }

  async connect(token: unknown): Promise<Result<Identity>> {
    this.disconnect()
    if (!this.origin) return { ok: false, error: 'unconfigured' }
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token.trim())) {
      return { ok: false, error: 'invalid_token' }
    }

    const credentials = { origin: this.origin, token: token.trim() }
    return this.perform(async signal => {
      const identity = object(await this.get(credentials, '/v1/me', signal))
      if (typeof identity.subject !== 'string' || !identity.subject || identity.role !== 'user') {
        throw new EarError(identity.role === 'admin' ? 'forbidden' : 'invalid_response')
      }
      if (signal.aborted) throw new EarError('disconnected')
      this.active = credentials
      return { subject: identity.subject, role: identity.role }
    })
  }

  async records(kind: unknown, cursor: unknown): Promise<Result<EarPage>> {
    if ((kind !== 'transcript_segment' && kind !== 'artifact')
      || (cursor !== null && (typeof cursor !== 'string' || cursor.length > 8192))) {
      return { ok: false, error: 'invalid_response' }
    }
    const active = this.active
    if (!active) return { ok: false, error: 'disconnected' }
    return this.perform(async signal => {
      const query = new URLSearchParams({ limit: '20' })
      if (cursor !== null) query.set('cursor', cursor)
      const page = object(await this.get(active, `/v1/records/${kind}?${query}`, signal))
      if (!Array.isArray(page.items)
        || (page.next_cursor !== null && (typeof page.next_cursor !== 'string'
          || !page.next_cursor || page.next_cursor === cursor))) throw new EarError('invalid_response')
      return { items: page.items.map(item => record(item, kind)), nextCursor: page.next_cursor }
    })
  }

  async transcript(id: unknown): Promise<Result<EarRecord>> {
    if (typeof id !== 'string' || !idPattern.test(id)) return { ok: false, error: 'not_found' }
    const active = this.active
    if (!active) return { ok: false, error: 'disconnected' }
    return this.perform(async signal => {
      const item = record(await this.get(active, `/v1/records/transcript_segment/${id}`, signal), 'transcript_segment')
      if (item.id !== id) throw new EarError('invalid_response')
      return item
    })
  }

  private async perform<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<Result<T>> {
    const signal = this.lifetime.signal
    try {
      const value = await operation(signal)
      return signal.aborted ? { ok: false, error: 'disconnected' } : { ok: true, value }
    } catch (error) {
      if (signal.aborted) return { ok: false, error: 'disconnected' }
      return { ok: false, error: error instanceof EarError ? error.code : 'connection' }
    }
  }

  private async get(credentials: { origin: string; token: string }, path: string, signal: AbortSignal): Promise<unknown> {
    const response = await this.request(new URL(path, credentials.origin), {
      headers: { Authorization: `Bearer ${credentials.token}`, Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    })
    if (!response.ok) {
      await response.body?.cancel()
      if (response.status >= 300 && response.status < 400) throw new EarError('redirect')
      if (response.status === 401) throw new EarError('unauthorized')
      if (response.status === 403) throw new EarError('forbidden')
      if (response.status === 404) throw new EarError('not_found')
      throw new EarError('server')
    }
    try {
      return await response.json()
    } catch (error) {
      if (error instanceof SyntaxError) throw new EarError('invalid_response')
      throw error
    }
  }
}
