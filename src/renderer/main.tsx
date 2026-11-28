import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import Markdown from 'react-markdown'
import type { CoverageTrack, DayRange, EarBridge, EarPage, EarRecord, Failure, Identity, RecordKind, Result, WeekCoverage } from '../shared/ear.js'
import { dayRange, localDay, monday } from './calendar.js'
import { RecordingPanel } from './recording.js'
import './styles.css'

declare global {
  interface Window { ear: EarBridge }
}

const message: Record<Failure, string> = {
  invalid_token: '请输入 43 位普通用户令牌。',
  unconfigured: '此版本尚未配置 EAR 云端，请联系部署方。',
  unauthorized: '令牌无效或已失效，请检查后重新连接。',
  forbidden: '此连接需要普通用户令牌，并且账号必须有权读取相应数据。',
  not_found: 'EAR 未返回这条记录或接口。',
  connection: '无法连接 EAR。请检查网络，或联系部署方确认服务和 HTTPS 证书。',
  redirect: '服务器返回了重定向，请联系部署方检查 EAR API 配置。',
  server: 'EAR 服务暂时无法完成请求，请稍后重试。',
  invalid_response: 'EAR 返回了无法识别的数据，请确认服务器版本和 API 地址。',
  disconnected: '连接已关闭，请重新连接。',
}

async function read<T>(operation: Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await operation
  } catch {
    return { ok: false, error: 'connection' }
  }
}

function RecordTime({ item }: { item: EarRecord }) {
  if (!item.start) return null
  const formatter = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium' })
  const start = new Date(item.start)
  const end = item.end ? new Date(item.end) : null
  return <time dateTime={item.start}>
    {end ? formatter.formatRange(start, end) : formatter.format(start)}
  </time>
}

function Summary({ item }: { item: EarRecord }) {
  const [evidence, setEvidence] = useState<EarRecord | null>(null)
  const [error, setError] = useState<Failure | null>(null)
  const [loading, setLoading] = useState(false)

  async function openEvidence(id: string) {
    setLoading(true)
    setEvidence(null)
    setError(null)
    const result = await read(window.ear.transcript(id))
    if (result.ok) setEvidence(result.value)
    else setError(result.error)
    setLoading(false)
  }

  return <article>
    <RecordTime item={item} />
    <div className="analysis-markdown">
      <Markdown
        skipHtml
        disallowedElements={['a', 'img']}
        unwrapDisallowed
        components={{
          h1: ({ children }) => <h3>{children}</h3>,
          h2: ({ children }) => <h4>{children}</h4>,
          h3: ({ children }) => <h5>{children}</h5>,
          h4: ({ children }) => <h6>{children}</h6>,
        }}
      >
        {item.text}
      </Markdown>
    </div>
    {item.evidenceIds.length > 0 && <details>
      <summary>原始证据（{item.evidenceIds.length}）</summary>
      <ul className="evidence-links">
        {item.evidenceIds.map((id, index) =>
          <li key={id}><button type="button" disabled={loading} onClick={() => void openEvidence(id)}>
            查看证据 {index + 1} 的转写
          </button></li>)}
      </ul>
      {loading && <p role="status">正在读取证据…</p>}
      {error && <p role="alert">{error === 'not_found' ? '该引用没有可查看的转写。' : message[error]}</p>}
      {evidence && <blockquote><RecordTime item={evidence} /><p className="record-text">{evidence.text}</p></blockquote>}
    </details>}
  </article>
}

const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' })
const shortDate = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' })
const fullDate = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'full' })
const clock = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

function CoverageBar({ track, index, kind }: { track: CoverageTrack; index: number; kind: keyof WeekCoverage }) {
  const bits = track.days[index]
  return <span className={'coverage-bar coverage-' + kind} aria-hidden="true" data-state={track.state}>
    {Array.from(bits.matchAll(/1+/g), run => <span
      key={run.index}
      style={{ left: (run.index / bits.length * 100) + '%', width: (run[0].length / bits.length * 100) + '%' }}
    />)}
  </span>
}

function DayFeed({ kind, range, date, refreshCoverage }: {
  kind: RecordKind
  range: DayRange
  date: Date
  refreshCoverage: () => void
}) {
  const [page, setPage] = useState<EarPage>({ items: [], nextCursor: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Failure | null>(null)

  const load = useCallback(async (cursor: string | null) => {
    setLoading(true)
    setError(null)
    const result = await read(window.ear.records(kind, cursor, range))
    if (result.ok) {
      const next = result.value
      setPage(previous => {
        if (cursor === null) return next
        const loaded = new Map(previous.items.map(item => [item.id, item]))
        for (const item of next.items) loaded.set(item.id, item)
        return { items: [...loaded.values()], nextCursor: next.nextCursor }
      })
    } else {
      setError(result.error)
    }
    setLoading(false)
  }, [kind, range])

  useEffect(() => { void load(null) }, [load])

  return <section className="reader" aria-labelledby="reading-date" aria-busy={loading}>
    <header className="reader-heading">
      <h2 id="reading-date">{fullDate.format(date)}</h2>
      <button type="button" disabled={loading} onClick={() => {
        refreshCoverage()
        void load(null)
      }}>刷新</button>
    </header>
    {error && <p className="reader-state error" role="alert">{message[error]}</p>}
    {loading && <p className="reader-state muted" role="status">正在加载…</p>}
    {!loading && !error && !page.items.length && <p className="reader-state muted">
      {kind === 'artifact' ? '当天没有可查看的分析笔记。' : '当天没有可查看的录音转写。'}
    </p>}
    <ol className="timeline">
      {page.items.map(item => <li className="timeline-entry" key={item.id}>
        <div className="timeline-marker">
          {item.start ? <time dateTime={item.start}>{clock.format(new Date(item.start))}</time> : <span>未记录</span>}
        </div>
        <div className="timeline-body">
          {kind === 'artifact' ? <Summary item={item} /> :
            <article>
              <RecordTime item={item} />
              <p className="record-text">{item.text}</p>
            </article>}
        </div>
      </li>)}
    </ol>
    {page.nextCursor && <button className="load-more" type="button" disabled={loading} onClick={() => void load(page.nextCursor)}>
      加载下一页
    </button>}
  </section>
}

function Timeline() {
  const [selected, setSelected] = useState(() => localDay(new Date()))
  const [kind, setKind] = useState<RecordKind>('artifact')
  const [coverageRevision, setCoverageRevision] = useState(0)
  const [coverage, setCoverage] = useState<{ week: number; result: Result<WeekCoverage> } | null>(null)

  const week = monday(selected).getTime()
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => localDay(new Date(week), index)), [week])
  const ranges = useMemo(() => days.map(dayRange), [days])
  const selectedIndex = days.findIndex(day => day.getTime() === selected.getTime())
  const currentCoverage = coverage?.week === week ? coverage.result : null
  const tracks = currentCoverage?.ok ? currentCoverage.value : null

  useEffect(() => {
    let current = true
    void read(window.ear.weekCoverage(ranges)).then(result => {
      if (current) setCoverage({ week, result })
    })
    return () => { current = false }
  }, [week, ranges, coverageRevision])

  function shiftWeek(offset: number) {
    const target = localDay(new Date(week), offset * 7)
    const today = localDay(new Date())
    setSelected(monday(today).getTime() === target.getTime() ? today : target)
  }

  return <div className="workspace">
    <aside className="week-sidebar" aria-label="按周选日期">
      <div className="week-header">
        <h2>日期</h2>
        <button type="button" onClick={() => setSelected(localDay(new Date()))}>今天</button>
      </div>
      <nav className="week-navigation" aria-label="切换周">
        <button type="button" onClick={() => shiftWeek(-1)}>‹ 上一周</button>
        <button type="button" onClick={() => shiftWeek(1)}>下一周 ›</button>
      </nav>
      <ol className="week-days">
        {days.map((day, index) => <li key={day.getTime()}>
          <button className="date-button" type="button" aria-current={index === selectedIndex ? 'date' : undefined}
            onClick={() => setSelected(day)} aria-label={fullDate.format(day)}
            aria-describedby={tracks ? 'coverage-' + index : undefined}>
            <span className="date-label">
              <span>{shortDate.format(day)}</span><span>{weekday.format(day)}</span>
            </span>
            {tracks && <>
              <CoverageBar track={tracks.timeline} index={index} kind="timeline" />
              <CoverageBar track={tracks.activity} index={index} kind="activity" />
              <span className="sr-only" id={'coverage-' + index}>
                {tracks.timeline.state === 'ready' ? '来源事件' : '来源事件覆盖不完整'}
                {tracks.timeline.days[index].includes('1') ? '有记录。' : '未显示记录。'}
                {tracks.activity.state === 'ready' ? '活动' : '活动覆盖不完整'}
                {tracks.activity.days[index].includes('1') ? '有记录。' : '未显示记录。'}
              </span>
            </>}
          </button>
        </li>)}
      </ol>
      <div className="coverage-legend">
        {tracks && <><span className="legend-timeline">来源事件</span><span className="legend-activity">活动</span></>}
        {tracks && (tracks.timeline.state !== 'ready' || tracks.activity.state !== 'ready')
          && <p>部分覆盖不可查看</p>}
        {currentCoverage && !currentCoverage.ok && <p role="status">周覆盖暂不可用</p>}
      </div>
    </aside>
    <div className="reader-pane">
      <div className="view-picker" role="group" aria-label="查看内容">
        <button type="button" aria-pressed={kind === 'artifact'} onClick={() => setKind('artifact')}>分析笔记</button>
        <button type="button" aria-pressed={kind === 'transcript_segment'} onClick={() => setKind('transcript_segment')}>录音转写</button>
      </div>
      <DayFeed key={selected.getTime() + kind} date={selected} kind={kind} range={ranges[selectedIndex]}
        refreshCoverage={() => setCoverageRevision(revision => revision + 1)} />
    </div>
  </div>
}

const pageLabels = { summary: '总结', capture: '采集', settings: '设置' } as const
type Page = keyof typeof pageLabels

const iconPaths = {
  summary: 'M6 3h9l4 4v14H6z M15 3v5h4 M9 12h7 M9 16h7',
  capture: 'M4 5h16v14H4z M10 5v14 M13 9h4 M13 13h4',
  settings: 'M4 7h16 M4 17h16 M8 5v4 M16 15v4',
  microphone: 'M9 6a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0z M5 11v1a7 7 0 0 0 14 0v-1 M12 19v3 M9 22h6',
  phone: 'M7 3h10v18H7z M11 18h2',
  archive: 'M4 4h16v4H4z M5 8v12h14V8 M10 12h4',
  chat: 'M5 17v-5a7 7 0 1 1 7 7H5l-2 2z M9 11h6 M9 14h4',
  mark: 'M7 9v6 M12 6v12 M17 8v8',
} as const

function AppIcon({ name }: { name: keyof typeof iconPaths }) {
  return <svg className="app-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={iconPaths[name]} /></svg>
}

function Settings({ configured, identity, connecting, onCapture, onConnect, onDisconnect }: {
  configured: boolean | null
  identity: Identity | null
  connecting: boolean
  onCapture: () => void
  onConnect: () => void
  onDisconnect: () => void
}) {
  return <div className="settings-page">
    <h2 className="page-title">设置</h2>
    <section className="settings-group" aria-labelledby="capture-settings">
      <h3 id="capture-settings">采集与权限</h3>
      <dl className="settings-list">
        <div><dt>麦克风</dt><dd><span>使用系统默认输入</span>
          <button type="button" onClick={onCapture}>打开采集</button>
        </dd></div>
      </dl>
    </section>
    <section className="settings-group" aria-labelledby="cloud-settings">
      <h3 id="cloud-settings">云端与存储</h3>
      <dl className="settings-list">
        <div><dt>EAR 云端</dt><dd>
          {identity ? <><span>{identity.subject}</span>
            <button type="button" disabled={connecting} onClick={onDisconnect}>退出登录</button></>
            : <><span>{configured === null ? '正在检查…' : configured ? '未连接' : '尚未配置'}</span>
              {configured && <button type="button" onClick={onConnect}>登录</button>}</>}
        </dd></div>
        <div><dt>本机录音</dt><dd>macOS 录音保存在本机</dd></div>
      </dl>
    </section>
    <section className="settings-group" aria-labelledby="mcp-settings">
      <h3 id="mcp-settings">MCP</h3>
      <dl className="settings-list">
        <div><dt>Codex</dt><dd>桌面端配置暂未提供</dd></div>
        <div><dt>Claude Code</dt><dd>桌面端配置暂未提供</dd></div>
      </dl>
    </section>
  </div>
}

function App() {
  const [configured, setConfigured] = useState<boolean | null>(null)
  useEffect(() => {
    void window.ear.configured().then(setConfigured, () => setConfigured(false))
  }, [])
  const [token, setToken] = useState('')
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [error, setError] = useState<Failure | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [page, setPage] = useState<Page>('summary')
  const [recording, setRecording] = useState(false)

  useEffect(() => window.ear.onSessionExpired(() => {
    setToken('')
    setIdentity(null)
    setError('unauthorized')
    setPage('summary')
    setConnecting(false)
  }), [])

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setConnecting(true)
    const result = await read(window.ear.connect(token))
    if (result.ok) {
      setToken('')
      setIdentity(result.value)
    } else {
      setError(result.error)
    }
    setConnecting(false)
  }

  async function disconnect() {
    setConnecting(true)
    try {
      await window.ear.disconnect()
      setIdentity(null)
    } catch {
      setError('connection')
    } finally {
      setConnecting(false)
    }
  }

  return <main className="application">
    <aside className="app-sidebar">
      <div className="workspace-name"><span><AppIcon name="mark" /></span>我的记录</div>
      <nav className="app-navigation" aria-label="主导航">
        {(Object.keys(pageLabels) as Page[]).map(item => <button key={item} type="button"
          aria-current={page === item ? 'page' : undefined} onClick={() => setPage(item)}>
          <AppIcon name={item} />{pageLabels[item]}
        </button>)}
      </nav>
    </aside>
    <div className="app-main">
      <header className="page-heading">
        <h1>{pageLabels[page]}</h1>
        {recording && <button type="button" className="recording-toggle" onClick={() => setPage('capture')}>录音中</button>}
      </header>
      <div className="app-page summary-page" hidden={page !== 'summary'}>
        {identity ? <Timeline /> : <section className="connection">
          <h2>登录 EAR</h2>
          {configured === null && <p className="muted" role="status">正在检查服务配置…</p>}
          {configured === false && <p className="error" role="alert">{message.unconfigured}</p>}
          {configured && <form onSubmit={event => void connect(event)}>
            <label htmlFor="token">普通用户令牌</label>
            <input id="token" type="password" required autoComplete="off" spellCheck={false}
              value={token} onChange={event => setToken(event.target.value)} disabled={connecting} />
            <p className="muted">关闭窗口后需要重新输入令牌。</p>
            {error && <p className="error" role="alert">{message[error]}</p>}
            <button className="primary" type="submit" disabled={connecting}>{connecting ? '正在登录…' : '使用令牌登录'}</button>
          </form>}
        </section>}
      </div>
      <div className="app-page capture-page" hidden={page !== 'capture'}>
        <section className="sources" aria-labelledby="sources-title">
          <h2 className="page-title" id="sources-title">数据来源</h2>
          <section className="source-group" aria-labelledby="local-sources">
            <h3 id="local-sources">这台设备</h3>
            <button type="button" className="source-row source-selected" aria-controls="recording-panel"
              onClick={() => document.getElementById('recording-heading')?.focus()}>
              <span className="source-name"><span className="source-icon"><AppIcon name="microphone" /></span><span><strong>桌面麦克风</strong><small>录音</small></span></span>
              {recording && <span className="recording-status">正在录音</span>}
            </button>
          </section>
          <section className="source-group" aria-labelledby="remote-devices">
            <h3 id="remote-devices">其他设备</h3>
            <div className="source-row">
              <span className="source-name"><span className="source-icon"><AppIcon name="phone" /></span><span><strong>EarRecorder</strong><small>手机采集</small></span></span>
            </div>
          </section>
          <section className="source-group" aria-labelledby="cloud-sources">
            <h3 id="cloud-sources">云端导入</h3>
            <div className="source-row">
              <span className="source-name"><span className="source-icon"><AppIcon name="archive" /></span><span><strong>旧 EAR</strong><small>已有录音与转写</small></span></span>
            </div>
            <div className="source-row">
              <span className="source-name"><span className="source-icon"><AppIcon name="chat" /></span><span><strong>LibreChat</strong><small>会话记录</small></span></span>
            </div>
          </section>
        </section>
        <RecordingPanel visible={page === 'capture'} onRecording={setRecording} />
      </div>
      <div className="app-page" hidden={page !== 'settings'}>
        {identity && error && <p className="settings-error error" role="alert">{message[error]}</p>}
        <Settings configured={configured} identity={identity} connecting={connecting}
          onCapture={() => setPage('capture')} onConnect={() => setPage('summary')} onDisconnect={() => void disconnect()} />
      </div>
    </div>
  </main>
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing renderer root')
createRoot(root).render(<App />)
