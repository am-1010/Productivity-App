import { ElectronAPI } from '@electron-toolkit/preload'
import type { NewTaskInput, Task } from '../shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      ping: () => Promise<string>
      getTasks: (day: string) => Promise<Task[]>
      getUpcomingTasks: (day: string) => Promise<Task[]>
      getOverdueTasks: (day: string) => Promise<Task[]>
      getTasksForRange: (from: string, to: string) => Promise<Task[]>
      searchTasks: (query: string) => Promise<Task[]>
      getDoneTasks: () => Promise<Task[]>
      addTask: (input: NewTaskInput) => Promise<void>
      updateTask: (id: string, input: NewTaskInput) => Promise<void>
      toggleTask: (id: string) => Promise<void>
      deleteTask: (id: string) => Promise<void>
    }
  }
}
