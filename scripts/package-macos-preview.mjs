import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { previewPort } from './synthetic-api.mjs'

const root = resolve(import.meta.dirname, '..')
const outputArg = process.argv[2]
if (process.platform !== 'darwin' || process.arch !== 'arm64' || !outputArg) {
  throw new Error('用法（Apple Silicon Mac） npm run package:mac-preview -- <输出目录>')
}
const electron = join(root, 'node_modules/electron/dist/Electron.app')
const executable = join(electron, 'Contents/MacOS/Electron')
const arch = execFileSync('/usr/bin/lipo', ['-archs', executable], { encoding: 'utf8' }).trim()
if (arch !== 'arm64') throw new Error('需要已安装的 arm64 Electron。')

const output = resolve(outputArg)
const archive = join(output, 'EAR-Desktop-Preview-arm64.zip')
if (existsSync(archive)) throw new Error('输出文件已存在，请选择新的输出目录。')
mkdirSync(output, { recursive: true })

const temp = mkdtempSync(join(output, '.ear-desktop-package-'))
try {
  const appName = 'EAR Desktop Preview'
  const app = join(temp, appName + '.app')
  const resources = join(app, 'Contents/Resources')
  const source = join(resources, 'app')
  const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' })
  execFileSync('/usr/bin/ditto', [electron, app])
  rmSync(join(resources, 'default_app.asar'), { force: true })
  mkdirSync(join(source, 'preview'), { recursive: true })
  cpSync(join(root, 'dist'), join(source, 'dist'), { recursive: true })
  writeFileSync(join(source, 'dist/main/ear-cloud.json'), JSON.stringify({
    origin: 'https://127.0.0.1:' + previewPort,
  }))
  for (const name of ['macos-preview.mjs', 'synthetic-api.mjs']) {
    cpSync(join(root, 'scripts', name), join(source, 'preview', name))
  }
  writeFileSync(join(source, 'package.json'), JSON.stringify({
    name: 'ear-desktop-preview',
    productName: appName,
    version: metadata.version,
    type: 'module',
    main: 'preview/macos-preview.mjs',
  }))

  const plist = join(app, 'Contents/Info.plist')
  for (const [key, value] of Object.entries({
    CFBundleName: appName,
    CFBundleDisplayName: appName,
    NSMicrophoneUsageDescription: 'EAR Desktop 在您点击开始录音后访问麦克风。',
    CFBundleIdentifier: 'org.echoasrecord.ear-desktop-preview',
    CFBundleShortVersionString: metadata.version,
    CFBundleVersion: metadata.version,
  })) {
    execFileSync('/usr/bin/plutil', ['-replace', key, '-string', value, plist])
  }
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
  const stagingArchive = join(temp, 'preview.zip')
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, stagingArchive])
  linkSync(stagingArchive, archive)
  console.log(archive)
} finally {
  rmSync(temp, { recursive: true, force: true })
}
