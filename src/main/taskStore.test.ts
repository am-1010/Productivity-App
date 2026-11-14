import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { openTaskStore, type TaskStore } from './taskStore'

// A fresh in-memory database for every test: fast, and your real tasks.db is
// never touched.
let store: TaskStore
beforeEach(() => {
  store = openTaskStore(new Database(':memory:'))
})

/** Today as 'YYYY-MM-DD' in local time, the same way SQLite's date('now','localtime') sees it. */
const today = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('addTask', () => {
  it('saves every field and starts the task as not done', () => {
    store.addTask({
      title: 'Write tests',
      day: '2026-11-13',
      notes: 'db first',
      start: 540,
      end: 600
    })

    expect(store.getTasksForDay('2026-11-13')).toEqual([
      expect.objectContaining({
        title: 'Write tests',
        day: '2026-11-13',
        notes: 'db first',
        start: 540,
        end: 600,
        done: false
      })
    ])
  })

  it('gives each task its own id', () => {
    store.addTask({ title: 'A' })
    store.addTask({ title: 'B' })
    const [a, b] = store.getTasksForDay('2026-11-13')
    expect(a.id).not.toBe(b.id)
  })
})

describe('getTasksForDay', () => {
  it('includes that day and undated open tasks, but not other days', () => {
    store.addTask({ title: 'Today', day: '2026-11-13' })
    store.addTask({ title: 'Someday' })
    store.addTask({ title: 'Tomorrow', day: '2026-11-14' })

    const titles = store.getTasksForDay('2026-11-13').map((t) => t.title)
    expect(titles).toEqual(expect.arrayContaining(['Today', 'Someday']))
    expect(titles).not.toContain('Tomorrow')
  })

  it('puts timed tasks first, earliest first, then untimed ones', () => {
    store.addTask({ title: 'No time', day: '2026-11-13' })
    store.addTask({ title: 'Afternoon', day: '2026-11-13', start: 840, end: 900 })
    store.addTask({ title: 'Morning', day: '2026-11-13', start: 540, end: 600 })

    expect(store.getTasksForDay('2026-11-13').map((t) => t.title)).toEqual([
      'Morning',
      'Afternoon',
      'No time'
    ])
  })
})

describe('getUpcomingTasks', () => {
  it('returns only later days, grouped by day then time', () => {
    store.addTask({ title: 'Today', day: '2026-11-13' })
    store.addTask({ title: 'Undated' })
    store.addTask({ title: 'Mon late', day: '2026-11-16', start: 900, end: 960 })
    store.addTask({ title: 'Sat', day: '2026-11-14' })
    store.addTask({ title: 'Mon early', day: '2026-11-16', start: 540, end: 600 })

    expect(store.getUpcomingTasks('2026-11-13').map((t) => t.title)).toEqual([
      'Sat',
      'Mon early',
      'Mon late'
    ])
  })
})

describe('toggleTask', () => {
  it('marks a task done, then not done again', () => {
    store.addTask({ title: 'Flip me', day: '2026-11-13' })
    const [task] = store.getTasksForDay('2026-11-13')

    store.toggleTask(task.id)
    expect(store.getTasksForDay('2026-11-13')[0].done).toBe(true)

    store.toggleTask(task.id)
    expect(store.getTasksForDay('2026-11-13')[0].done).toBe(false)
  })

  it('files a completed undated task under today so it stays in the Done list', () => {
    store.addTask({ title: 'Undated' })
    const [task] = store.getTasksForDay(today())

    store.toggleTask(task.id)

    expect(store.getTasksForDay(today())).toEqual([
      expect.objectContaining({ title: 'Undated', day: today(), done: true })
    ])
  })
})

describe('deleteTask', () => {
  it('removes only that task', () => {
    store.addTask({ title: 'Keep', day: '2026-11-13' })
    store.addTask({ title: 'Remove', day: '2026-11-13' })
    const remove = store.getTasksForDay('2026-11-13').find((t) => t.title === 'Remove')!

    store.deleteTask(remove.id)

    expect(store.getTasksForDay('2026-11-13').map((t) => t.title)).toEqual(['Keep'])
  })
})

describe('migrations', () => {
  it('adds the notes column to a database made before notes existed', () => {
    const old = new Database(':memory:')
    old.exec(
      'CREATE TABLE task (id TEXT PRIMARY KEY, title TEXT NOT NULL, day TEXT, start_min INTEGER, end_min INTEGER, done_at INTEGER, project TEXT, source TEXT)'
    )
    old.exec("INSERT INTO task (id, title, day) VALUES ('1', 'Old task', '2026-11-13')")

    const oldStore = openTaskStore(old)

    expect(old.pragma('user_version', { simple: true })).toBe(2)
    expect(oldStore.getTasksForDay('2026-11-13')).toEqual([
      expect.objectContaining({ title: 'Old task', notes: undefined })
    ])
  })

  it('can be run again on an up-to-date database without errors', () => {
    const db = new Database(':memory:')
    openTaskStore(db)
    expect(() => openTaskStore(db)).not.toThrow()
  })
})
