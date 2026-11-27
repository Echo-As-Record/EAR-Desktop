# 联调与验收

当前验收以[云端接口](integration.md)为准。分别记录平台、数据来源、验证日期和使用的代码版本。能够构建应用、能打开窗口和能读取真实云端数据是三个不同的验收结果。

| 项目 | 当前状态 |
|---|---|
| TypeScript 检查、主进程和渲染进程构建 | 已通过。 |
| macOS Apple Silicon + 合成 HTTPS | 已通过。覆盖固定服务地址、错误令牌、权限不足、拒绝重定向、分页、证据展开，以及两个合成账号依次登录时的桌面数据清理。 |
| 真实云端 EAR 到 macOS | 待验收。需要构建时预设正式 HTTPS 根地址、普通用户读取权限，以及已入库的转写和对应分析产物。 |
| 云端真实账号隔离 | 待验收。合成账号切换只验证桌面会话清理。云端需单独验证上传、后台处理、记录和原音访问。 |
| Windows x64 | 待在 Windows 上验收依赖安装、类型检查、构建、窗口启动和相同的读取流程。 |
| 桌面端 MCP 安装及发行打包 | 待实现。上游 EAR 已提供独立的 `stdio` 入口。 |

## macOS 本机可复跑的合成联调

在仓库根目录执行 `npm ci`。需要 Bash、Node.js 22.12+ 和支持 `req -addext` 的 OpenSSL。将下面的代码保存为仓库外的临时脚本，从仓库根目录用 `bash /path/to/ear-smoke.sh` 运行。脚本只监听回环地址，使用合成转写和测试令牌。它为这次启动生成临时证书，退出时清理本地测试服务和文件。证书仅通过当前进程的 `NODE_EXTRA_CA_CERTS` 生效。

```bash
set -euo pipefail
smoke_dir=$(mktemp -d)
mock_pid=
cleanup() {
  if [[ -n "$mock_pid" ]]; then
    kill "$mock_pid" 2>/dev/null || true
    wait "$mock_pid" 2>/dev/null || true
  fi
  rm -rf -- "$smoke_dir"
}
trap cleanup EXIT

openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj '/CN=127.0.0.1' -addext 'subjectAltName=IP:127.0.0.1' \
  -keyout "$smoke_dir/key.pem" -out "$smoke_dir/cert.pem" 2>"$smoke_dir/openssl.log" ||
  { cat "$smoke_dir/openssl.log"; exit 1; }

node --input-type=module - "$smoke_dir" <<'JS' &
import { createServer } from 'node:https'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
const first = '01950000-0000-7000-8000-000000000001'
const second = '01950000-0000-7000-8000-000000000002'
const summary = '01950000-0000-7000-8000-000000000003'
const row = (data_type, id, payload) => ({
  data_type, id, payload,
  event_start: '2026-11-27T01:00:00Z',
  event_end: '2026-11-27T01:01:00Z',
})

const server = createServer({
  key: readFileSync(join(dir, 'key.pem')),
  cert: readFileSync(join(dir, 'cert.pem')),
}, (req, res) => {
  const url = new URL(req.url, 'https://127.0.0.1')
  const send = (status, data) => res
    .writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data))
  const auth = req.headers.authorization
  if (auth === 'Bearer ' + 'r'.repeat(43)) {
    if (url.pathname === '/redirected') {
      throw new Error('The client followed a redirect')
    }
    return res.writeHead(302, { Location: '/redirected' }).end()
  }
  if (auth === 'Bearer ' + 'f'.repeat(43)) return send(403, { code: 'forbidden' })
  const secondAccount = auth === 'Bearer ' + 't'.repeat(43)
  if (!secondAccount && auth !== 'Bearer ' + 's'.repeat(43)) {
    return send(401, { code: 'unauthorized' })
  }
  if (url.pathname === '/v1/me') {
    return send(200, { subject: secondAccount ? 'desktop-fixture-2' : 'desktop-fixture', role: 'user' })
  }
  if (secondAccount && url.pathname === '/v1/records/transcript_segment') {
    return send(200, { items: [row('transcript_segment', second, { text: '第二账号合成转写' })], next_cursor: null })
  }
  if (secondAccount && url.pathname === '/v1/records/artifact') {
    return send(200, { items: [], next_cursor: null })
  }
  if (secondAccount) return send(404, { code: 'not_found' })
  if (url.pathname === '/v1/records/transcript_segment') {
    const next = url.searchParams.get('cursor') === 'next+page'
    const item = row('transcript_segment', next ? second : first, {
      text: next ? '分页第二条' : '首条合成转写',
    })
    return send(200, { items: [item], next_cursor: next ? null : 'next+page' })
  }
  if (url.pathname === '/v1/records/artifact') {
    const item = row('artifact', summary, { body_md: '合成总结', evidence_ids: [first] })
    return send(200, { items: [item], next_cursor: null })
  }
  if (url.pathname === '/v1/records/transcript_segment/' + first) {
    return send(200, row('transcript_segment', first, { text: '首条合成转写' }))
  }
  return send(404, { code: 'not_found' })
})

server.listen(0, '127.0.0.1', () => {
  writeFileSync(join(dir, 'origin'), 'https://127.0.0.1:' + server.address().port)
})
JS
mock_pid=$!

for try in {1..30}; do
  [[ -s "$smoke_dir/origin" ]] && break
  sleep 0.2
done
[[ -s "$smoke_dir/origin" ]] || { echo 'Synthetic EAR API did not start' >&2; exit 1; }
printf 'EAR API: %s\n' "$(cat "$smoke_dir/origin")"
node -e 'for (const [label, ch] of [["success", "s"], ["second account", "t"], ["401", "x"], ["403", "f"], ["redirect", "r"]]) console.log(label + ": " + ch.repeat(43))'
EAR_DESKTOP_API_URL="$(cat "$smoke_dir/origin")" \
  NODE_EXTRA_CA_CERTS="$smoke_dir/cert.pem" npm run dev
```

1. 确认应用没有地址输入框，分别使用 `401`、`403` 和 `redirect` 的合成令牌，确认各自提示正确。
2. 用 `success` 的合成令牌连接，确认显示 `desktop-fixture`、「首条合成转写」与「合成总结」。
3. 点「加载下一页」，确认增加「分页第二条」。在合成总结中展开「原始证据」，确认返回「首条合成转写」。
4. 点「退出登录」，确认结果和令牌输入框清空。用 `second account` 的令牌重新登录，应显示「第二账号合成转写」，且上一账号的转写和总结不再出现。这一步验证桌面会话清理，真实服务的账号隔离另行验收。关闭测试窗口后按 `Ctrl+C` 结束命令，模拟服务与证书会随脚本清理。

## 真实云端验收

- 用普通用户令牌连接，确认识别到正确的账号。
- 先查一段已入库的录音，再打开对应分析产物的原始证据，核对内容、时间和引用。手机上传和云端分析的验证另记，避免把查询旧数据算作完整链路通过。
- 检查错误令牌、权限不足、断网和空列表。退出后用另一个账号登录，确认上一账号的结果消失。
- 私有试点验证两个账号各自只能看到获授权的数据。记录实例版本和现象，故障记录使用合成内容或脱敏摘要。
