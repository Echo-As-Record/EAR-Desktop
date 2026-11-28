import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import Markdown from 'react-markdown'
import type { CoverageTrack, DayRange, EarBridge, EarPage, EarRecord, Failure, Identity, RecordKind, Result, WeekCoverage } from '../shared/ear.js'
import { dayRange, localDay, monday } from './calendar.js'
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

function App() {
  const [configured, setConfigured] = useState<boolean | null>(null)
  useEffect(() => {
    void window.ear.configured().then(setConfigured, () => setConfigured(false))
  }, [])
  const [token, setToken] = useState('')
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [error, setError] = useState<Failure | null>(null)
  const [connecting, setConnecting] = useState(false)

  useEffect(() => window.ear.onSessionExpired(() => {
    setToken('')
    setIdentity(null)
    setError('unauthorized')
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

  return <main className={identity ? "application" : "login-page"}>
    <header className="page-heading">
      <div><h1>EAR Desktop</h1>{!identity && <p className="muted">录音转写与分析</p>}</div>
      {identity && <div className="account">
        <span title={identity.subject}>{identity.subject}</span>
        <button type="button" disabled={connecting} onClick={() => void disconnect()}>退出登录</button>
      </div>}
    </header>
    {identity ? <>
      {error && <p className="error" role="alert">{message[error]}</p>}
      <Timeline />
    </> : <section className="panel connection">
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
  </main>
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing renderer root')
createRoot(root).render(<App />)
