import { contextBridge, ipcRenderer } from 'electron'
import type { EarBridge } from '../shared/ear.js'

const ear: EarBridge = {
  configured: () => ipcRenderer.invoke('ear:configured'),
  connect: token => ipcRenderer.invoke('ear:connect', token),
  disconnect: () => ipcRenderer.invoke('ear:disconnect'),
  onSessionExpired: listener => {
    const channel = 'ear:session-expired'
    const notify = () => listener()
    ipcRenderer.on(channel, notify)
    return () => { ipcRenderer.removeListener(channel, notify) }
  },
  records: (kind, cursor, day) => ipcRenderer.invoke('ear:records', kind, cursor, day),
  weekCoverage: days => ipcRenderer.invoke('ear:week-coverage', days),
  transcript: id => ipcRenderer.invoke('ear:transcript', id),
}

contextBridge.exposeInMainWorld('ear', ear)
