import { useEffect, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import type { EarBridge, EarPage, EarRecord, Failure, Identity, RecordKind, Result } from '../shared/ear.js'
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
    <p className="record-text">{item.text}</p>
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

function Records({ kind, title, empty }: { kind: RecordKind; title: string; empty: string }) {
  const [page, setPage] = useState<EarPage>({ items: [], nextCursor: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Failure | null>(null)

  async function load(cursor: string | null) {
    setLoading(true)
    setError(null)
    const result = await read(window.ear.records(kind, cursor))
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
  }

  useEffect(() => { void load(null) }, [kind])

  return <section className="panel" aria-label={title} aria-busy={loading}>
    <div className="panel-heading">
      <h2>{title}</h2>
      <button type="button" disabled={loading} onClick={() => void load(null)}>刷新</button>
    </div>
    {error && <p className="error" role="alert">{message[error]}</p>}
    {loading && <p className="muted" role="status">正在加载…</p>}
    {!loading && !error && !page.items.length && <p className="muted">{empty}</p>}
    <div className="records">
      {page.items.map(item => kind === 'artifact'
        ? <Summary key={item.id} item={item} />
        : <article key={item.id}><RecordTime item={item} /><p className="record-text">{item.text}</p></article>)}
    </div>
    {page.nextCursor && <button type="button" disabled={loading} onClick={() => void load(page.nextCursor)}>
      加载下一页
    </button>}
  </section>
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

  return <main>
    <header className="page-heading">
      <div><h1>EAR Desktop</h1><p className="muted">录音转写与分析</p></div>
      {identity && <div className="account">
        <span title={identity.subject}>{identity.subject}</span>
        <button type="button" disabled={connecting} onClick={() => void disconnect()}>退出登录</button>
      </div>}
    </header>
    {identity ? <>
      {error && <p className="error" role="alert">{message[error]}</p>}
      <div className="results">
        <Records kind="transcript_segment" title="录音转写" empty="当前没有可查看的转写。" />
        <Records kind="artifact" title="分析结果" empty="当前没有可查看的分析结果。" />
      </div>
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
