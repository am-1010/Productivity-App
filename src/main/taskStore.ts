import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import type { NewTaskInput, Task, TaskSource } from '../shared/types'

export interface TaskStore {
  getTasksForDay(day: string): Task[]
  getUpcomingTasks(day: string): Task[]
  addTask(input: NewTaskInput): void
  toggleTask(id: string): void
  deleteTask(id: string): void
}

interface TaskRow {
  id: string
  title: string
  project: string | null
  source: string | null
  day: string | null
  start_min: number | null
  end_min: number | null
  done_at: number | null
  notes: string | null
}

function toTask(r: TaskRow): Task {
  return {
    id: r.id,
    title: r.title,
    project: r.project ?? undefined,
    source: (r.source as TaskSource | null) ?? undefined,
    day: r.day ?? undefined,
    notes: r.notes ?? undefined,
    start: r.start_min ?? undefined,
    end: r.end_min ?? undefined,
    done: r.done_at != null
  }
}

/**
 * Brings `db` up to the latest schema and returns the task queries that run
 * against it. Knows nothing about Electron, so tests can pass an in-memory
 * database.
 */
export function openTaskStore(db: Database.Database): TaskStore {
  function hasColumn(table: string, column: string): boolean {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    return cols.some((c) => c.name === column)
  }

  // Each entry upgrades the schema by one version. PRAGMA user_version records
  // how may have run. Only ever append to this list; never edit a past entry.
  const migrations: Array<() => void> = [
    // v1: original table
    () =>
      db.exec(`
                CREATE TABLE IF NOT EXISTS task (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                project TEXT,
                source TEXT, 
                day TEXT,
                start_min INTEGER,
                end_min INTEGER,
                done_at INTEGER
                );
                CREATE INDEX IF NOT EXISTS task_day_start ON task(day, start_min);
            `),
    // v2: notes. Databases made by the previous code may already have it.
    () => {
      if (!hasColumn('task', 'notes')) db.exec('ALTER TABLE task ADD COLUMN notes TEXT')
    }
  ]

  const version = db.pragma('user_version', { simple: true }) as number
  db.transaction(() => {
    for (let v = version; v < migrations.length; v++) migrations[v]()
    db.pragma(`user_version = ${migrations.length}`)
  })()

  return {
    // Tasks for one local day ('YYYY-MM-DD'), plus open tasks that have no day yet.
    getTasksForDay(day: string): Task[] {
      const rows = db
        .prepare(
          `SELECT * FROM task 
                    WHERE day = ? OR (day IS NULL AND done_at IS NULL)
                    ORDER BY start_min IS NULL, start_min`
        )
        .all(day) as TaskRow[]
      return rows.map(toTask)
    },

    getUpcomingTasks(day: string): Task[] {
      const rows = db
        .prepare(
          `SELECT * FROM task
                    WHERE day > ?
                    ORDER BY day, start_min IS NULL, start_min`
        )
        .all(day) as TaskRow[]
      return rows.map(toTask)
    },

    addTask(input: NewTaskInput): void {
      db.prepare(
        'INSERT INTO task (id, title, day, notes, start_min, end_min) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(
        randomUUID(),
        input.title,
        input.day ?? null,
        input.notes ?? null,
        input.start ?? null,
        input.end ?? null
      )
    },

    // done_at is milliseconds (Date.now()). Completing a task with no day files it
    // under today, so it stays visible in the Done list instead of vanishing
    toggleTask(id: string): void {
      db.prepare(
        `Update task SET
                    day = CASE WHEN done_at IS NULL THEN COALESCE(day, date('now', 'localtime')) ELSE day END, 
                    done_at = CASE WHEN done_at IS NULL THEN ? ELSE NULL END 
                WHERE id = ?`
      ).run(Date.now(), id)
    },

    deleteTask(id: string): void {
      db.prepare('DELETE FROM task WHERE id = ?').run(id)
    }
  }
}
