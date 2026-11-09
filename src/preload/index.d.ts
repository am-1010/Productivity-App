import { ElectronAPI } from '@electron-toolkit/preload'

type TaskSource = 'gmail' | 'slack' | 'linear'

interface Task {
  id: string
  title: string
  project?: string
  source?: TaskSource
  day?: string
  notes?: string
  start?: number
  end?: number
  done?: boolean
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      ping: () => Promise<string>
      getTasks: (day: string) => Promise<Task[]>
      addTask: (input: { title: string; day?: string; notes?: string; start?: number; end?: number }) => Promise<void>
      toggleTask: (id: string) => Promise<void>
      deleteTask: (id: string) => Promise<void>
    }
  }
}
