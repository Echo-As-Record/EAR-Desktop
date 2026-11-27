import { contextBridge, ipcRenderer } from 'electron'
import type { EarBridge } from '../shared/ear.js'

const ear: EarBridge = {
  configured: () => ipcRenderer.invoke('ear:configured'),
  connect: token => ipcRenderer.invoke('ear:connect', token),
  disconnect: () => ipcRenderer.invoke('ear:disconnect'),
  records: (kind, cursor) => ipcRenderer.invoke('ear:records', kind, cursor),
  transcript: id => ipcRenderer.invoke('ear:transcript', id),
}

contextBridge.exposeInMainWorld('ear', ear)
