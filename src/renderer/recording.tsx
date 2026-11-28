import { useEffect, useRef, useState } from 'react'
import workletUrl from './recording-worklet.js?url&no-inline'
import { maxSamples, sampleRate, type RecordingBridge, type RecordingList } from '../shared/recording.js'

declare global {
  interface Window { earRecording: RecordingBridge }
}

const waveBars = 36

async function capture(onEnded: () => void) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: false })
  let context: AudioContext | undefined
  let opened = false
  try {
    const audio = context = new AudioContext({ sampleRate })
    await audio.audioWorklet.addModule(workletUrl)
    const input = audio.createMediaStreamSource(stream)
    const node = new AudioWorkletNode(audio, 'ear-pcm-capture', {
      channelCount: 1, channelCountMode: 'explicit', numberOfOutputs: 0,
    })
    await audio.resume()
    await window.earRecording.start()
    opened = true
    let writes = Promise.resolve()
    let failure: unknown
    let samples = 0
    let flush: (() => void) | undefined
    node.port.onmessage = event => {
      if (event.data === 'flushed') {
        flush?.()
        return
      }
      if (!(event.data instanceof ArrayBuffer) || failure || samples >= maxSamples) return
      const remaining = (maxSamples - samples) * 2
      const data = event.data.byteLength > remaining ? event.data.slice(0, remaining) : event.data
      samples += data.byteLength / 2
      writes = writes.then(async () => {
        if (!failure) await window.earRecording.append(data)
      }).catch(error => {
        failure = error
        onEnded()
      })
      if (samples >= maxSamples) onEnded()
    }
    for (const track of stream.getTracks()) track.addEventListener('ended', onEnded)
    const analyser = audio.createAnalyser()
    analyser.fftSize = 1024
    const waveform = new Float32Array(analyser.fftSize)
    input.connect(node)
    input.connect(analyser)

    return {
      readWaveform() {
        analyser.getFloatTimeDomainData(waveform)
        const binSize = Math.floor(waveform.length / waveBars)
        return Array.from({ length: waveBars }, (_, index) => {
          let peak = 0
          for (let sample = index * binSize; sample < (index + 1) * binSize; sample++) {
            peak = Math.max(peak, Math.abs(waveform[sample]))
          }
          return Math.min(1, peak * 3)
        })
      },
      async stop(onMicrophoneClosed: () => void) {
        await new Promise<void>(resolve => {
          const timer = window.setTimeout(resolve, 600)
          flush = () => { window.clearTimeout(timer); resolve() }
          node.port.postMessage('stop')
        })
        input.disconnect()
        node.port.close()
        for (const track of stream.getTracks()) track.stop()
        onMicrophoneClosed()
        await audio.close().catch(() => {})
        await writes
        await window.earRecording.finish()
        if (failure) throw new Error('录音写入中断，已写入的部分已保留。')
      },
    }
  } catch (error) {
    for (const track of stream.getTracks()) track.stop()
    await context?.close().catch(() => {})
    if (opened) await window.earRecording.finish().catch(() => {})
    throw error
  }
}

function displayDuration(seconds: number): string {
  return [Math.floor(seconds / 60), seconds % 60].map(value => String(value).padStart(2, '0')).join(':')
}

function detail(error: unknown, fallback: string): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return '麦克风权限未开启，请在系统设置中允许。'
  if (error instanceof DOMException && error.name === 'NotFoundError') return '找不到可以录音的麦克风。'
  if (error instanceof Error) {
    const message = error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    if (/^[\u3400-\u9fff]/.test(message)) return message
  }
  return fallback
}

const stateLabel = { incomplete: '未完成 · 原音已保留', saved: '本机已保存', uploaded: '已上传' }
const dateTime = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })

export function RecordingPanel({ visible, onRecording }: { visible: boolean; onRecording: (recording: boolean) => void }) {
  const [list, setList] = useState<RecordingList | null>(null)
  const [phase, setPhase] = useState<'idle' | 'starting' | 'recording' | 'saving'>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [waveform, setWaveform] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const [token, setToken] = useState('')
  const current = useRef<Awaited<ReturnType<typeof capture>> | null>(null)

  async function refresh() {
    try { setList(await window.earRecording.list()) }
    catch { setError('无法读取本机录音目录。') }
  }

  useEffect(() => { if (visible) void refresh() }, [visible])
  useEffect(() => {
    if (phase !== 'recording') return
    const start = performance.now()
    const timer = window.setInterval(() => setElapsed(Math.floor((performance.now() - start) / 1000)), 250)
    return () => window.clearInterval(timer)
  }, [phase])

  useEffect(() => {
    if (!visible || phase !== 'recording') return
    const timer = window.setInterval(() => {
      if (current.current) setWaveform(current.current.readWaveform())
    }, 80)
    return () => window.clearInterval(timer)
  }, [phase, visible])

  async function start() {
    setError(null)
    setPhase('starting')
    setElapsed(0)
    setWaveform([])
    try {
      current.current = await capture(() => { void stop() })
      setPhase('recording')
      onRecording(true)
    } catch (cause) {
      setError(detail(cause, '无法开始录音。'))
      setPhase('idle')
    }
  }

  async function stop() {
    const session = current.current
    if (!session) return
    current.current = null
    setPhase('saving')
    try { await session.stop(() => onRecording(false)) }
    catch (cause) { setError(detail(cause, '保存录音失败，已写入的音频仍保存在本机。')) }
    finally {
      onRecording(false)
      await refresh()
      setPhase('idle')
    }
  }

  async function upload(id: string) {
    setError(null)
    setUploading(id)
    try { await window.earRecording.upload(id, token) }
    catch (cause) { setError(detail(cause, '上传失败，录音仍保存在本机。')) }
    finally {
      await refresh()
      setUploading(null)
    }
  }

  return <section id="recording-panel" className="recording-panel" hidden={!visible} aria-labelledby="recording-heading">
    <div className="recording-inner">
      <h2 id="recording-heading" tabIndex={-1}>桌面麦克风</h2>
      <p className="muted">系统默认麦克风</p>
      {list?.available && <div className="recording-card">
        <div className="recording-heading">
          <div>
            <p className={phase === 'recording' ? 'recording-status' : 'muted'}>
              {phase === 'recording' ? '正在录音' : phase === 'saving' ? '正在保存录音' : '麦克风录音'}
            </p>
            {phase === 'recording' && <p className="recording-elapsed">{displayDuration(elapsed)}</p>}
          </div>
          <button type="button" className={phase === 'recording' ? 'recording-stop' : 'primary'}
            disabled={phase === 'starting' || phase === 'saving'}
            onClick={() => phase === 'recording' ? void stop() : void start()}>
            {phase === 'recording' ? '停止录音' : phase === 'starting' ? '正在启动…' : phase === 'saving' ? '正在保存…' : '开始录音'}
          </button>
        </div>
        {phase === 'recording' && <svg className="recording-wave" viewBox="0 0 360 36" preserveAspectRatio="none" aria-hidden="true">
          {Array.from({ length: waveBars }, (_, index) => {
            const height = Math.max(3, (waveform[index] ?? 0) * 32)
            return <rect key={index} x={index * 10 + 2} y={(36 - height) / 2} width="5" height={height} rx="2" />
          })}
        </svg>}
      </div>}
      {error && <p className="error recording-message" role="alert">{error}</p>}
      {list && !list.available && <p className="muted recording-message">录音目前支持 macOS。</p>}
      {list?.available && <>
        {list.uploadConfigured ? <div className="recording-auth">
          <label htmlFor="upload-token">上传令牌</label>
          <input id="upload-token" type="password" value={token} autoComplete="off" spellCheck={false}
            onChange={event => setToken(event.target.value)} />
          <details><summary>本机设备 ID</summary><code>{list.deviceId}</code></details>
        </div> : <p className="muted recording-message">尚未配置上传服务，录音会保存在本机。</p>}
        <h3 className="recent-recordings">最近录音</h3>
        {list.items.length === 0 && <p className="muted recording-message">暂无本机录音。</p>}
        {list.items.length > 0 && <ul className="recording-list">
          {list.items.map(item => <li key={item.id}>
            <div>
              <time dateTime={item.startedAt}>{dateTime.format(new Date(item.startedAt))}</time>
              {item.durationMs > 0 && <span className="recording-length">{displayDuration(Math.floor(item.durationMs / 1000))}</span>}
            </div>
            <div className="recording-controls">
              <span className={item.state === 'uploaded' ? 'upload-complete' : 'muted'}>{stateLabel[item.state]}</span>
              {item.state === 'saved' && list.uploadConfigured && <button type="button" className="primary"
                disabled={uploading !== null || !token.trim()} onClick={() => void upload(item.id)}>
                {uploading === item.id ? '上传中…' : '上传'}
              </button>}
            </div>
          </li>)}
        </ul>}
      </>}
    </div>
  </section>
}
