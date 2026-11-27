# 联调与验收

当前验收以[云端接口](integration.md)为准。分别记录平台、数据来源、验证日期和使用的代码版本。能够构建应用、能打开窗口和能读取真实云端数据是三个不同的验收结果。

| 项目 | 当前状态 |
|---|---|
| TypeScript 检查、主进程和渲染进程构建 | 已通过。 |
| macOS Apple Silicon + 合成 HTTPS | 已通过。覆盖固定服务地址、错误令牌、权限不足、拒绝重定向、周历选日、分页、证据展开，以及两个合成账号依次登录时的桌面数据清理。 |
| 真实云端 EAR 到 macOS | 待验收。需要构建时预设正式 HTTPS 根地址、普通用户读取权限，以及已入库的转写和对应分析产物。 |
| 云端真实账号隔离 | 待验收。合成账号切换只验证桌面会话清理。云端需单独验证上传、后台处理、记录和原音访问。 |
| Windows x64 | 待在 Windows 上验收依赖安装、类型检查、构建、窗口启动和相同的读取流程。 |
| macOS Apple Silicon 预览包 | 可生成带合成 HTTPS 服务的本机测试应用。见[预览包说明](development.md#apple-silicon-本机预览包)。 |
| 桌面端 MCP 安装及正式发行包 | 待实现。上游 EAR 已提供独立的 `stdio` 入口。 |

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
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSyntheticApi } from './scripts/synthetic-api.mjs'

const dir = process.argv[2]
const server = createSyntheticApi({
  key: readFileSync(join(dir, 'key.pem')),
  cert: readFileSync(join(dir, 'cert.pem')),
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
2. 用 `success` 登录，确认显示 `desktop-fixture`，默认选中今天。左侧周历显示七天，蓝线和红线分别对应来源事件与活动。
3. 分析笔记按时间排列，检查标题、强调、列表和代码块。展开「桌面端开发讨论」的第一条原始证据，确认显示「先把一周的记录按日期整理」。
4. 点「上一周」，确认出现「上一周的笔记」。点「今天」返回。切到「录音转写」，点「加载下一页」，确认同一天的第二条转写追加在第一条之后。
5. 在合成服务连接中断后，确认结果区提示失败。服务恢复后点「刷新」，当天结果和周覆盖都可重新读取。若云端对已登录的读取请求返回 401，应用应返回登录页并清空记录和令牌。
6. 退出并用 `second account` 重新登录。周覆盖暂不可用时，仍可切到「录音转写」查看「第二账号合成转写」。上一账号的笔记、转写和证据不会再次出现。关闭窗口并按 `Ctrl+C` 释放测试服务。

## 真实云端验收

- 用普通用户令牌连接，确认识别到正确的账号。
- 先查一段已入库的录音，再打开对应分析产物的原始证据，核对内容、时间和引用。手机上传和云端分析的验证另记，避免把查询旧数据算作完整链路通过。
- 检查错误令牌、权限不足、断网和空列表。退出后用另一个账号登录，确认上一账号的结果消失。
- 私有试点验证两个账号各自只能看到获授权的数据。记录实例版本和现象，故障记录使用合成内容或脱敏摘要。
