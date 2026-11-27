import { createServer } from 'node:https'

export const previewPort = 18877
export const syntheticUserToken = 's'.repeat(43)

export function createSyntheticApi(tls, beforeRequest) {
  const first = '01950000-0000-7000-8000-000000000001'
  const second = '01950000-0000-7000-8000-000000000002'
  const summary = '01950000-0000-7000-8000-000000000003'
  const laterNote = '01950000-0000-7000-8000-000000000004'
  const oldNote = '01950000-0000-7000-8000-000000000005'
  const today = new Date()
  const at = (offset, hour, minute) => new Date(
    today.getFullYear(), today.getMonth(), today.getDate() + offset, hour, minute,
  )
  const row = (data_type, id, payload, offset, hour, minute, duration = 1) => ({
    data_type, id, payload,
    event_start: at(offset, hour, minute).toISOString(),
    event_end: new Date(at(offset, hour, minute).getTime() + duration * 60000).toISOString(),
  })
  const firstText = '先把一周的记录按日期整理，右侧按时间逐条阅读。需要核对时，可以从笔记回到原始转写。'
  const summaryMarkdown = [
    '# 桌面端开发讨论', '', '本轮先交付 **按日阅读** 和分析笔记。', '',
    '- 左侧按周选择日期。', '- 笔记保留对应的原始转写。', '',
    '~~~sh', 'npm run typecheck', '~~~',
  ].join('\n')
  const notes = [
    row('artifact', summary, { body_md: summaryMarkdown, evidence_ids: [first] }, 0, 9, 15, 29),
    row('artifact', laterNote, {
      body_md: '# 发布前检查\n\n复查选日、切换视图和证据回查，再交给团队验收。',
      evidence_ids: [second],
    }, 0, 14, 10, 22),
    row('artifact', oldNote, { body_md: '# 上一周的笔记', evidence_ids: [] }, -7 - ((today.getDay() + 6) % 7), 10, 20),
  ]
  const transcripts = [
    row('transcript_segment', first, { text: firstText }, 0, 9, 16),
    row('transcript_segment', second, { text: '下午再看一次分页和扩展窗口后的布局。' }, 0, 14, 12),
  ]
  const startWithin = (record, url) =>
    Date.parse(url.searchParams.get('start')) <= Date.parse(record.event_start) &&
    Date.parse(record.event_start) < Date.parse(url.searchParams.get('end'))
  const coverage = (days, records) => ({
    state: 'ready',
    days: days.map(([start, end]) => Array.from({ length: Math.ceil((end - start) / 300000) }, (_, i) => {
      const slot = start + i * 300000
      return records.some(record => Date.parse(record.event_start) < slot + 300000 &&
        Date.parse(record.event_end) > slot) ? '1' : '0'
    }).join('')),
  })

  return createServer(tls, async (req, res) => {
    const url = new URL(req.url, 'https://127.0.0.1')
    if (beforeRequest) await beforeRequest(req, res, url)
    if (res.destroyed || res.writableEnded) return
    const send = (status, data) => res
      .writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data))
    if (req.method !== 'GET') return send(405, { code: 'method_not_allowed' })
    const auth = req.headers.authorization
    if (auth === 'Bearer ' + 'r'.repeat(43)) {
      if (url.pathname === '/redirected') {
        throw new Error('The client followed a redirect')
      }
      return res.writeHead(302, { Location: '/redirected' }).end()
    }
    if (auth === 'Bearer ' + 'f'.repeat(43)) return send(403, { code: 'forbidden' })
    const secondAccount = auth === 'Bearer ' + 't'.repeat(43)
    if (!secondAccount && auth !== 'Bearer ' + syntheticUserToken) {
      return send(401, { code: 'unauthorized' })
    }
    if (url.pathname === '/v1/me') {
      return send(200, { subject: secondAccount ? 'desktop-fixture-2' : 'desktop-fixture', role: 'user' })
    }
    if (url.pathname === '/v1/week-coverage') {
      if (secondAccount) return send(403, { code: 'forbidden' })
      const days = url.searchParams.get('days')?.split(',').map(day => day.split('/').map(Date.parse))
      if (!days || days.length < 1 || days.length > 7 || days.some(day =>
        day.length !== 2 || !(day[1] > day[0] && day[1] - day[0] <= 26 * 3600000))) {
        return send(422, { code: 'invalid_input' })
      }
      return send(200, { slot_seconds: 300, timeline: coverage(days, transcripts), activity: coverage(days, notes) })
    }
    if (url.pathname === '/v1/records/transcript_segment') {
      const source = secondAccount
        ? [row('transcript_segment', second, { text: '第二账号合成转写' }, 0, 11, 0)]
        : transcripts
      const items = source.filter(record => startWithin(record, url))
      const offset = url.searchParams.get('cursor') === 'next+page' ? 1 : 0
      return send(200, { items: items.slice(offset, offset + 1), next_cursor: items.length > offset + 1 ? 'next+page' : null })
    }
    if (url.pathname === '/v1/records/artifact') {
      return send(200, { items: secondAccount ? [] : notes.filter(record => startWithin(record, url)), next_cursor: null })
    }
    if (!secondAccount && url.pathname === '/v1/records/transcript_segment/' + first) {
      return send(200, transcripts[0])
    }
    return send(404, { code: 'not_found' })
  })
}
