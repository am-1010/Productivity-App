import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import type { NewTaskInput, Task, TaskSource } from '../shared/types'

export interface TaskStore {
  getTasksForDay(day: string): Task[]
  getUpcomingTasks(day: string): Task[]
  getOverdueTasks(day: string): Task[]
  getTasksForRange(from: string, to: string): Task[]
  searchTasks(query: string): Task[]
  getDoneTasks(): Task[]
  addTask(input: NewTaskInput): void
  updateTask(id: string, input: NewTaskInput): void
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
    done: r.done_at != null,
    doneAt: r.done_at ?? undefined
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

    // Unfinished tasks from days before `day`: the most recent day first, then by time.
    getOverdueTasks(day: string): Task[] {
      const rows = db
        .prepare(
          `SELECT * FROM task
            WHERE day < ? AND done_at IS NULL
            ORDER BY day DESC, start_min IS NULL, start_min`
        )
        .all(day) as TaskRow[]
      return rows.map(toTask)
    },

    // Evert task dated from `from` to `to`, both included ('YYYY-MM-DD').
    getTasksForRange(from: string, to: string): Task[] {
      const rows = db
        .prepare(
          `SELECT * FROM TASK
             WHERE day BETWEEN ? AND ?
             ORDER BY day, start_min IS NULL, start_min`
        )
        .all(from, to) as TaskRow[]
      return rows.map(toTask)
    },

    // Every task whose title or notes contain `query`, in any case. Tasks with no
    // date come first, then the newest day first. At most 100.
    searchTasks(query: string): Task[] {
      const text = query.trim()
      if (!text) return []
      // % and _ are wildcards in LIKE; escape them so they match themselves.
      const pattern = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
      const rows = db
        .prepare(
          `SELECT * FROM task
            WHERE title LIKE @pattern ESCAPE '\\' OR notes LIKE @pattern ESCAPE '\\'
            ORDER BY day IS NOT NULL, day DESC, start_min IS NULL, start_min LIMIT 100`
        )
        .all({ pattern }) as TaskRow[]
      return rows.map(toTask)
    },

    // Finished tasks, most recently ticked off first. At most 200.
    getDoneTasks(): Task[] {
      const rows = db
        .prepare('SELECT * FROM task WHERE done_at IS NOT NULL ORDER BY done_at DESC LIMIT 200')
        .all() as TaskRow[]
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

    // Replaces the editable fields. Done state is left alone. A done task keeps
    // its day if the date is cleared, so it doesn't vanish from the Done List
    updateTask(id: string, input: NewTaskInput): void {
      db.prepare(
        `UPDATE task SET
                title = @title,
                notes = @notes,
                start_min = @start,
                end_min = @end,
                day = CASE WHEN @day IS NULL AND done_at IS NOT NULL THEN day ELSE @day END
            WHERE id = @id`
      ).run({
        id,
        title: input.title,
        day: input.day ?? null,
        notes: input.notes ?? null,
        start: input.start ?? null,
        end: input.end ?? null
      })
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
