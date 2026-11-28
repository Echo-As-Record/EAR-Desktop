import { app, BrowserWindow, ipcMain, screen, type IpcMainInvokeEvent } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { channels } from '../shared/ear.js'
import { recordingChannels } from '../shared/recording.js'
import { Recordings } from './recordings.js'
import { EarSession, connectionOrigin } from './ear-api.js'

const renderer = join(import.meta.dirname, '../renderer/index.html')
const rendererUrl = pathToFileURL(renderer).href
const sessions = new Map<number, EarSession>()

function readCloudOrigin(key: string): string | null {
  try {
    const config = JSON.parse(readFileSync(join(import.meta.dirname, 'ear-cloud.json'), 'utf8'))
    return typeof config[key] === 'string' ? connectionOrigin(config[key]) : null
  } catch {
    return null
  }
}

const cloudOrigin = readCloudOrigin('origin')
const ingestOrigin = readCloudOrigin('ingestOrigin')
let recordings: Recordings | undefined

function recordingStore(event: IpcMainInvokeEvent): Recordings {
  sessionFor(event)
  return recordings ??= new Recordings(join(app.getPath('userData'), 'recordings'), ingestOrigin)
}

function sessionFor(event: IpcMainInvokeEvent): EarSession {
  const session = sessions.get(event.sender.id)
  if (!session || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== rendererUrl) {
    throw new Error('Unexpected EAR request source')
  }
  return session
}

ipcMain.handle(channels.configured, event => sessionFor(event).origin !== null)
ipcMain.handle(channels.connect, (event, token: unknown) => sessionFor(event).connect(token))
ipcMain.handle(channels.disconnect, event => sessionFor(event).disconnect())
ipcMain.handle(channels.records, (event, kind: unknown, cursor: unknown, day: unknown) =>
  sessionFor(event).records(kind, cursor, day))
ipcMain.handle(channels.weekCoverage, (event, days: unknown) => sessionFor(event).weekCoverage(days))
ipcMain.handle(channels.transcript, (event, id: unknown) => sessionFor(event).transcript(id))

ipcMain.handle(recordingChannels.list, event => recordingStore(event).list())
ipcMain.handle(recordingChannels.start, event => recordingStore(event).start(event.sender.id))
ipcMain.handle(recordingChannels.append, (event, data: unknown) => recordingStore(event).append(event.sender.id, data))
ipcMain.handle(recordingChannels.finish, event => recordingStore(event).finish(event.sender.id))
ipcMain.handle(recordingChannels.upload, (event, id: unknown, token: unknown) => recordingStore(event).upload(id, token))

function openWindow(): void {
  const workArea = screen.getPrimaryDisplay().workAreaSize
  const window = new BrowserWindow({
    title: 'EAR Desktop',
    width: Math.min(1280, workArea.width),
    height: Math.min(820, workArea.height),
    minWidth: Math.min(400, workArea.width),
    minHeight: Math.min(420, workArea.height),
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  const contents = window.webContents
  contents.session.setPermissionCheckHandler((sender, permission, _origin, details) =>
    process.platform === 'darwin' && sender === contents && permission === 'media' && details.isMainFrame
    && details.requestingUrl === rendererUrl && details.mediaType === 'audio')
  contents.session.setPermissionRequestHandler((sender, permission, resolve, details) => {
    resolve(process.platform === 'darwin' && sender === contents && permission === 'media' && details.isMainFrame
      && details.requestingUrl === rendererUrl && 'mediaTypes' in details
      && details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'audio')
  })
  const contentsId = contents.id
  const session = new EarSession(cloudOrigin, fetch, () => {
    if (!window.webContents.isDestroyed()) window.webContents.send(channels.sessionExpired)
  })
  sessions.set(contentsId, session)
  window.webContents.once('destroyed', () => {
    session.disconnect()
    sessions.delete(contentsId)
    void recordings?.finish(contentsId).catch(() => {})
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  void window.loadFile(renderer).catch(() => {
    console.error('EAR Desktop could not load its local interface.')
    app.quit()
  })
}

void app.whenReady().then(() => {
  openWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
