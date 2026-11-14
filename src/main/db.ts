import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { openTaskStore } from './taskStore'

const db: Database.Database = new Database(join(app.getPath('userData'), 'tasks.db'))
db.pragma('journal_mode = WAL')

export const { getTasksForDay, getUpcomingTasks, addTask, toggleTask, deleteTask } =
  openTaskStore(db)

export default db
