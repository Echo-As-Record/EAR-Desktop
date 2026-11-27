export type RecordKind = 'transcript_segment' | 'artifact'

export interface Identity {
  subject: string
  role: string
}

export interface EarRecord {
  id: string
  start: string | null
  end: string | null
  text: string
  evidenceIds: string[]
}

export interface EarPage {
  items: EarRecord[]
  nextCursor: string | null
}

export type Failure = 'invalid_token' | 'unconfigured' | 'unauthorized' | 'forbidden' | 'not_found'
  | 'connection' | 'redirect' | 'server' | 'invalid_response' | 'disconnected'

export type Result<T> = { ok: true; value: T } | { ok: false; error: Failure }

export const channels = {
  configured: 'ear:configured',
  connect: 'ear:connect',
  disconnect: 'ear:disconnect',
  records: 'ear:records',
  transcript: 'ear:transcript',
} as const

export interface EarBridge {
  configured(): Promise<boolean>
  connect(token: string): Promise<Result<Identity>>
  disconnect(): Promise<void>
  records(kind: RecordKind, cursor: string | null): Promise<Result<EarPage>>
  transcript(id: string): Promise<Result<EarRecord>>
}
