import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { NewTaskInput } from '../shared/types';

// Custom APIs for renderer
const api = {
  ping: () => ipcRenderer.invoke('app:ping'),
  getTasks: (day: string) => ipcRenderer.invoke('tasks:get', day),
  getUpcomingTasks: (day: string) => ipcRenderer.invoke('tasks:upcoming', day),
  addTask: (input: NewTaskInput) => ipcRenderer.invoke('tasks:add', input),
  toggleTask: (id: string) => ipcRenderer.invoke('tasks:toggle', id),
  deleteTask: (id: string) => ipcRenderer.invoke('tasks:delete', id)
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
