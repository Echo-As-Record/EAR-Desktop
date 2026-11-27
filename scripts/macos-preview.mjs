import { app, dialog } from 'electron'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setDefaultCACertificates } from 'node:tls'
import { createSyntheticApi, previewPort } from './synthetic-api.mjs'

function createCertificate() {
  const directory = mkdtempSync(join(tmpdir(), 'ear-desktop-preview-tls-'))
  const key = join(directory, 'key.pem')
  const cert = join(directory, 'cert.pem')
  try {
    execFileSync('/usr/bin/openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
      '-keyout', key, '-out', cert,
    ], { stdio: 'ignore', timeout: 10_000 })
    return { key: readFileSync(key), cert: readFileSync(cert) }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

try {
  const tls = createCertificate()
  setDefaultCACertificates([tls.cert])
  const server = createSyntheticApi(tls)
  app.once('before-quit', () => server.close())
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(previewPort, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  await import('../dist/main/main.js')
} catch (error) {
  await app.whenReady()
  dialog.showErrorBox('无法启动 EAR Desktop 预览版', error?.code === 'EADDRINUSE'
    ? '本机测试端口正在使用。请关闭已打开的 EAR Desktop 预览版后再试。'
    : '未能启动本机合成 HTTPS 服务。')
  app.quit()
}
