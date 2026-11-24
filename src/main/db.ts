import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { openEventStore } from './eventStore'
import { openTaskStore } from './taskStore'

const db: Database.Database = new Database(join(app.getPath('userData'), 'tasks.db'))
db.pragma('journal_mode = WAL')

export const {
  getTasksForDay,
  getUpcomingTasks,
  getOverdueTasks,
  getTasksForRange,
  searchTasks,
  getDoneTasks,
  addTask,
  updateTask,
  toggleTask,
  deleteTask
} = openTaskStore(db)

// Connected calendars. Opened after the task store, which makes their tables.
export const eventStore = openEventStore(db)

export default db
