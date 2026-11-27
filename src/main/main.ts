import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

function openWindow(): void {
  const window = new BrowserWindow({
    title: 'EAR Desktop',
    width: 960,
    height: 620,
    minWidth: 400,
    minHeight: 360,
    backgroundColor: '#f4f5f2',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  void window.loadFile(join(import.meta.dirname, '../renderer/index.html')).catch(() => {
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
