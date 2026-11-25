import { ElectronAPI } from '@electron-toolkit/preload'
import type { CalendarEvent, Connection, NewTaskInput, Task } from '../shared/types'

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
      getEventsForRange: (from: string, to: string) => Promise<CalendarEvent[]>
      listConnections: () => Promise<Connection[]>
      removeConnection: (id: string) => Promise<void>
      /** Only works while developing (npm run dev). */
      addSampleCalendar: () => Promise<void>
      /** Fetches the latest events from every connected Google account. */
      syncConnections: () => Promise<void>
      /** Opens Google's sign-in in the browser; settles once signed in and synced. */
      connectGoogle: () => Promise<void>
      /** Signes in again after Google signed the app out. */
      reconnectGoogle: (id: string) => Promise<void>
      /** Stops a sign-in that is waiting for the browser. */
      cancelGoogleSignIn: () => Promise<void>
    }
  }
}
