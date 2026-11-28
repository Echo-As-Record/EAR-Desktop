import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  appendFileSync, mkdirSync, openAsBlob, openSync, closeSync, readFileSync, readdirSync,
  renameSync, statSync, unlinkSync, writeFileSync, writeSync,
} from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { maxSamples, sampleRate, type LocalRecording, type RecordingList } from '../shared/recording.js'

const run = promisify(execFile)
const captureId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const audioName = 'segment_0001.m4a'

function wavHeader(bytes: number): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(bytes + 36, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(bytes, 40)
  return header
}

export class Recordings {
  private active: { owner: number; recording: LocalRecording; bytes: number } | null = null
  private readonly uploading = new Set<string>()
  readonly available = process.platform === 'darwin'
  readonly deviceId: string

  constructor(private readonly root: string, private readonly ingestOrigin: string | null) {
    mkdirSync(root, { recursive: true, mode: 0o700 })
    const identity = join(root, 'device-id')
    try {
      writeFileSync(identity, 'ear-desktop-' + randomUUID(), { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error
    }
    this.deviceId = readFileSync(identity, 'utf8')
  }

  private path(id: string, name: string): string { return join(this.root, id, name) }

  private read(id: string): LocalRecording {
    if (!captureId.test(id)) throw new Error('找不到这段录音。')
    const row = JSON.parse(readFileSync(this.path(id, 'recording.json'), 'utf8')) as LocalRecording
    if (row.id !== id) throw new Error('录音信息无效。')
    return row
  }

  private save(row: LocalRecording): void {
    const temporary = this.path(row.id, 'recording.tmp')
    writeFileSync(temporary, JSON.stringify(row), { mode: 0o600 })
    renameSync(temporary, this.path(row.id, 'recording.json'))
  }

  list(): RecordingList {
    const items = readdirSync(this.root, { withFileTypes: true }).flatMap(entry => {
      if (!entry.isDirectory() || !captureId.test(entry.name) || entry.name === this.active?.recording.id) return []
      try { return [this.read(entry.name)] } catch { return [] }
    })
    items.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    return { available: this.available, uploadConfigured: this.ingestOrigin !== null, deviceId: this.deviceId, items }
  }

  start(owner: number): void {
    if (!this.available || this.active) throw new Error('暂时无法开始录音。')
    const recording: LocalRecording = { id: randomUUID(), startedAt: new Date().toISOString(), durationMs: 0, state: 'incomplete' }
    mkdirSync(join(this.root, recording.id), { mode: 0o700 })
    this.save(recording)
    writeFileSync(this.path(recording.id, 'capture.wav.part'), wavHeader(0), { flag: 'wx', mode: 0o600 })
    this.active = { owner, recording, bytes: 0 }
  }

  append(owner: number, samples: unknown): void {
    const active = this.active
    if (active?.owner !== owner || !(samples instanceof ArrayBuffer)
      || samples.byteLength < 2 || samples.byteLength % 2 !== 0 || samples.byteLength > sampleRate * 2
      || active.bytes + samples.byteLength > maxSamples * 2) throw new Error('录音数据无效。')
    appendFileSync(this.path(active.recording.id, 'capture.wav.part'), Buffer.from(samples))
    active.bytes += samples.byteLength
  }

  async finish(owner: number): Promise<void> {
    const active = this.active
    if (active?.owner !== owner) return
    this.active = null
    const row = active.recording
    const input = this.path(row.id, 'capture.wav.part')
    const bytes = statSync(input).size - 44
    if (bytes < 32 || bytes % 2 !== 0) throw new Error('这段录音没有足够的音频。')
    const fd = openSync(input, 'r+')
    try {
      const header = wavHeader(bytes)
      if (writeSync(fd, header, 0, header.length, 0) !== header.length) throw new Error('无法写入录音文件。')
    } finally { closeSync(fd) }

    const staging = this.path(row.id, 'encoding.m4a')
    try {
      await run('/usr/bin/afconvert', ['-f', 'm4af', '-d', 'aac', '-c', '1', '-b', '32000', input, staging],
        { timeout: 90_000 })
    } catch { throw new Error('无法编码 M4A，原始音频仍保存在本机。') }
    renameSync(staging, this.path(row.id, audioName))
    this.save({ ...row, durationMs: Math.floor(bytes / 32), state: 'saved' })
    // Once the M4A and its state exist, a cleanup failure must not report a failed save.
    try { unlinkSync(input) } catch { /* Keep the source on disk when cleanup fails. */ }
  }

  async upload(id: unknown, token: unknown): Promise<void> {
    if (!this.ingestOrigin) throw new Error('尚未配置录音接收服务。')
    if (typeof id !== 'string' || typeof token !== 'string' || !/^[!-~]{1,1024}$/.test(token.trim())) {
      throw new Error('请输入有效的上传令牌。')
    }
    const row = this.read(id)
    if (row.state === 'uploaded') return
    if (row.state !== 'saved' || this.uploading.has(id)) throw new Error('这段录音暂时无法上传。')
    this.uploading.add(id)
    try {
      const form = new FormData()
      form.set('name', 'DesktopVoice')
      form.set('text', '')
      form.set('type', 'richVoice')
      form.set('source', 'local')
      form.set('group_id', row.id)
      form.set('timestamp', row.startedAt)
      form.set('segment_start_ms', '0')
      form.set('segment_end_ms', String(row.durationMs))
      form.set('segment_meta', JSON.stringify({
        segmentIndex: 0, segmentStartMs: 0, segmentEndMs: row.durationMs, source: 'desktop_local',
      }))
      form.set('file', await openAsBlob(this.path(id, audioName), { type: 'audio/mp4' }), audioName)

      let response: Response
      try {
        response = await fetch(new URL('/api/v1/record', this.ingestOrigin), {
          method: 'POST', body: form, redirect: 'manual', signal: AbortSignal.timeout(120_000),
          headers: { Authorization: 'Bearer ' + token.trim(), 'X-Device-Id': this.deviceId },
        })
      } catch { throw new Error('无法连接录音接收服务，请恢复网络后重试。') }
      if (!response.ok) {
        await response.body?.cancel()
        if (response.status === 401 || response.status === 403) throw new Error('上传令牌无效或未获授权。')
        throw new Error('接收服务未确认录音，请稍后重试。')
      }
      const receipt = await response.json().catch(() => null)
      if (receipt?.ok !== true || typeof receipt.record_id !== 'string' || !receipt.record_id) {
        throw new Error('接收服务未返回有效回执，录音已保留。')
      }
      this.save({ ...row, state: 'uploaded', recordId: receipt.record_id })
    } finally {
      this.uploading.delete(id)
    }
  }
}
