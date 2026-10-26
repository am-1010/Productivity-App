import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'

const dbPath = join(app.getPath('userData'), 'tasks.db')

const db: Database.Database = new Database(dbPath)
db.pragma('journal_mode = WAL')

function hasColumn(table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return cols.some((c) => c.name === column)
}

// Each entry upgrades the schema by one version. PRAGMA user_version records
// how many have run. Only ever append to this list; never edit a past entry.
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

export interface Task {
  id: string
  title: string
  project?: string
  source?: string
  day?: string
  notes?: string
  start?: number
  end?: number
  done: boolean
}

function toTask(r: TaskRow): Task {
  return {
    id: r.id,
    title: r.title,
    project: r.project ?? undefined,
    source: r.source ?? undefined,
    day: r.day ?? undefined,
    notes: r.notes ?? undefined,
    start: r.start_min ?? undefined,
    end: r.end_min ?? undefined,
    done: r.done_at != null
  }
}

// Tasks for one local day ('YYYY-MM-DD'), plus open tasks that have no day yet.
export function getTasksForDay(day: string): Task[] {
  const rows = db
    .prepare(
      `SELECT * FROM task
         WHERE day = ? OR (day IS NULL AND done_at IS NULL)
         ORDER BY start_min IS NULL, start_min`
    )
    .all(day) as TaskRow[]
  return rows.map(toTask)
}

export function addTask(input: { title: string; day?: string; notes?: string }): void {
  db.prepare('INSERT INTO task (id, title, day, notes) VALUES (?, ?, ?, ?)').run(
    randomUUID(),
    input.title,
    input.day ?? null,
    input.notes ?? null
  )
}

// done_at is milliseconds (Date.now()). Completing a task with no day files it
// under today, so it stays visible in the Done list instead of vanishing.
export function toggleTask(id: string): void {
  db.prepare(
    `UPDATE task SET
            day = CASE WHEN done_at IS NULL THEN COALESCE(day, date('now', 'localtime')) ELSE day END,
            done_at = CASE WHEN done_at IS NULL THEN ? ELSE NULL END
         WHERE id = ?`
  ).run(Date.now(), id)
}

export function deleteTask(id: string): void {
  db.prepare('DELETE FROM task WHERE id = ?').run(id)
}

export default db
