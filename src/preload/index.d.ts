import { ElectronAPI } from '@electron-toolkit/preload'

type TaskSource = 'gmail' | 'slack' | 'linear'

interface Task {
  id: string
  title: string
  project?: string
  source?: TaskSource
  start?: number
  end?: number
  done?: boolean
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      ping: () => Promise<string>
      getTasks: () => Promise<Task[]>
      addTask: (title: string) => Promise<void>
      toggleTask: (id: string) => Promise<void>
    }
  }
}