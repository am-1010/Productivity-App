import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'

const dbPath = join(app.getPath('userData'), 'tasks.db')

const db: Database.Database = new Database(dbPath)

db.exec(`CREATE TABLE IF NOT EXISTS task (
    id TEXT PRIMARY KEY, 
    title TEXT NOT NULL, 
    project TEXT, 
    source TEXT, 
    day TEXT,
    start_min INTEGER,
    end_min INTEGER,
    done_at INTEGER,
    notes TEXT
    );
    
    CREATE INDEX IF NOT EXISTS task_day_start ON task(day, start_min);
`)

interface TaskRow {
    id: string
    title: string
    project: string | null
    source: string | null
    day: string | null
    start_min: number | null
    end_min: number | null
    done_at: number | null
}

export function getTasks() {
    const rows = db.prepare('SELECT * FROM task ORDER BY start_min').all() as TaskRow[]

    return rows.map((r) => ({
        id: r.id,
        title: r.title,
        project: r.project ?? undefined,
        source: r.source?? undefined,
        start: r.start_min ?? undefined,
        end: r.end_min ?? undefined,
        done: r.done_at != null
    }))
}

export function addTask(input: { title: string; day?: string; notes?: string}) {
    db.prepare('INSERT INTO task (id, title, day, notes) VALUES (?, ?, ?, ?)').run(randomUUID(), input.title, input.day ?? null, input.notes ?? null)
}

export function toggleTask(id: string) {
    db.prepare(
        'UPDATE task SET done_at = CASE WHEN done_at IS NULL THEN ? ELSE NULL END WHERE id = ?'
    ).run(Date.now(), id)
}

export default db