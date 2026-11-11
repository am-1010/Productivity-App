import { ElectronAPI } from '@electron-toolkit/preload'
import type { NewTaskInput, Task } from '../shared/types'


declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      ping: () => Promise<string>
      getTasks: (day: string) => Promise<Task[]>
      getUpcomingTasks: (day: string) => Promise<Task[]>
      addTask: (input: NewTaskInput) => Promise<void>
      toggleTask: (id: string) => Promise<void>
      deleteTask: (id: string) => Promise<void>
    }
  }
}
