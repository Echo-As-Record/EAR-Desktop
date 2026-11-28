export type RecordKind = 'transcript_segment' | 'artifact'

export interface DayRange {
  start: string
  end: string
}

export interface CoverageTrack {
  state: 'ready' | 'partial' | 'unavailable'
  days: string[]
}

export interface WeekCoverage {
  timeline: CoverageTrack
  activity: CoverageTrack
}

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
  sessionExpired: 'ear:session-expired',
  disconnect: 'ear:disconnect',
  records: 'ear:records',
  weekCoverage: 'ear:week-coverage',
  transcript: 'ear:transcript',
} as const

export interface EarBridge {
  configured(): Promise<boolean>
  connect(token: string): Promise<Result<Identity>>
  disconnect(): Promise<void>
  onSessionExpired(listener: () => void): () => void
  records(kind: RecordKind, cursor: string | null, day: DayRange): Promise<Result<EarPage>>
  weekCoverage(days: DayRange[]): Promise<Result<WeekCoverage>>
  transcript(id: string): Promise<Result<EarRecord>>
}
