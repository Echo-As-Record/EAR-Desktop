export const sampleRate = 16_000
export const maxSamples = sampleRate * 30 * 60
export const recordingChannels = {
  list: 'recording:list',
  start: 'recording:start',
  append: 'recording:append',
  finish: 'recording:finish',
  upload: 'recording:upload',
} as const

export interface LocalRecording {
  id: string
  startedAt: string
  durationMs: number
  state: 'incomplete' | 'saved' | 'uploaded'
  recordId?: string
}

export interface RecordingList {
  available: boolean
  uploadConfigured: boolean
  deviceId: string
  items: LocalRecording[]
}

export interface RecordingBridge {
  list(): Promise<RecordingList>
  start(): Promise<void>
  append(samples: ArrayBuffer): Promise<void>
  finish(): Promise<void>
  upload(id: string, token: string): Promise<void>
}
