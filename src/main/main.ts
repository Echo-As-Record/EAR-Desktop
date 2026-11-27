import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { channels } from '../shared/ear.js'
import { EarSession, connectionOrigin } from './ear-api.js'

const renderer = join(import.meta.dirname, '../renderer/index.html')
const rendererUrl = pathToFileURL(renderer).href
const sessions = new Map<number, EarSession>()

function readCloudOrigin(): string | null {
  try {
    const config = JSON.parse(readFileSync(join(import.meta.dirname, 'ear-cloud.json'), 'utf8'))
    return typeof config.origin === 'string' ? connectionOrigin(config.origin) : null
  } catch {
    return null
  }
}

const cloudOrigin = readCloudOrigin()

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
ipcMain.handle(channels.records, (event, kind: unknown, cursor: unknown) =>
  sessionFor(event).records(kind, cursor))
ipcMain.handle(channels.transcript, (event, id: unknown) => sessionFor(event).transcript(id))

function openWindow(): void {
  const window = new BrowserWindow({
    title: 'EAR Desktop',
    width: 960,
    height: 680,
    minWidth: 400,
    minHeight: 420,
    backgroundColor: '#f4f5f2',
    webPreferences: {
      preload: join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  const contentsId = window.webContents.id
  const session = new EarSession(cloudOrigin)
  sessions.set(contentsId, session)
  window.webContents.once('destroyed', () => {
    session.disconnect()
    sessions.delete(contentsId)
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
