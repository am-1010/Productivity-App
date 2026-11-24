import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

describe('getOverdueTasks', () => {
  it('returns unfinished tasks from earlier days, the most recent day first', () => {
    store.addTask({ title: 'Today', day: '2026-11-13' })
    store.addTask({ title: 'Undated' })
    store.addTask({ title: 'Tomorrow', day: '2026-11-14' })
    store.addTask({ title: 'Last week', day: '2026-11-06' })
    store.addTask({ title: 'Yesterday late', day: '2026-11-12', start: 900, end: 960 })
    store.addTask({ title: 'Yesterday untimed', day: '2026-11-12' })
    store.addTask({ title: 'Yesterday early', day: '2026-11-12', start: 540, end: 600 })
    store.addTask({ title: 'Finished', day: '2026-11-11' })
    store.toggleTask(store.searchTasks('Finished')[0].id)

    expect(store.getOverdueTasks('2026-11-13').map((t) => t.title)).toEqual([
      'Yesterday early',
      'Yesterday late',
      'Yesterday untimed',
      'Last week'
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

    expect(old.pragma('user_version', { simple: true })).toBe(3)
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

describe('updateTask', () => {
  it('replaces the title, day, notes and times', () => {
    store.addTask({ title: 'Draft', day: '2026-11-13', start: 540, end: 600 })
    const [task] = store.getTasksForDay('2026-11-13')

    store.updateTask(task.id, {
      title: 'Final',
      day: '2026-11-14',
      notes: 'moved',
      start: 600,
      end: 660
    })

    expect(store.getTasksForDay('2026-11-13')).toEqual([])
    expect(store.getUpcomingTasks('2026-11-13')).toEqual([
      expect.objectContaining({
        id: task.id,
        title: 'Final',
        day: '2026-11-14',
        notes: 'moved',
        start: 600,
        end: 660
      })
    ])
  })

  it('clears fields that are left empty', () => {
    store.addTask({ title: 'Timed', day: '2026-11-13', notes: 'x', start: 540, end: 600 })
    const [task] = store.getTasksForDay('2026-11-13')

    store.updateTask(task.id, { title: 'Timed', day: '2026-11-13' })

    const [updated] = store.getTasksForDay('2026-11-13')
    expect(updated.notes).toBeUndefined()
    expect(updated.start).toBeUndefined()
    expect(updated.end).toBeUndefined()
  })

  it('keeps a task done after editing it', () => {
    store.addTask({ title: 'Done already', day: '2026-11-13' })
    const [task] = store.getTasksForDay('2026-11-13')
    store.toggleTask(task.id)

    store.updateTask(task.id, { title: 'Renamed', day: '2026-11-13' })

    expect(store.getTasksForDay('2026-11-13')[0]).toEqual(
      expect.objectContaining({ title: 'Renamed', done: true })
    )
  })

  it('keeps a done task on its day if the date is cleared', () => {
    store.addTask({ title: 'Done', day: '2026-11-13' })
    const [task] = store.getTasksForDay('2026-11-13')
    store.toggleTask(task.id)

    store.updateTask(task.id, { title: 'Done' })

    expect(store.getTasksForDay('2026-11-13')[0].day).toBe('2026-11-13')
  })
})

describe('getTasksForRange', () => {
  it('returns task dated within the range, both ends included, in day then time order', () => {
    store.addTask({ title: 'Before', day: '2026-11-08' })
    store.addTask({ title: 'Sun', day: '2026-11-15' })
    store.addTask({ title: 'Mon late', day: '2026-11-09', start: 900, end: 960 })
    store.addTask({ title: 'Mon early', day: '2026-11-09', start: 540, end: 600 })
    store.addTask({ title: 'After', day: '2026-11-16' })
    store.addTask({ title: 'Undated' })

    expect(store.getTasksForRange('2026-11-09', '2026-11-15').map((t) => t.title)).toEqual([
      'Mon early',
      'Mon late',
      'Sun'
    ])
  })
})

describe('searchTasks', () => {
  it('finds tasks by title or notes, in any case', () => {
    store.addTask({ title: 'Essay draft', day: '2026-11-20' })
    store.addTask({ title: 'Groceries', notes: 'milk, ESSAY paper' })
    store.addTask({ title: 'Gym', day: '2026-11-21' })

    expect(store.searchTasks('essay').map((t) => t.title)).toEqual(['Groceries', 'Essay draft'])
  })

  it('puts undated tasks first, then the newest day first', () => {
    store.addTask({ title: 'Read old', day: '2026-11-01' })
    store.addTask({ title: 'Read new', day: '2026-11-30' })
    store.addTask({ title: 'Read someday' })

    expect(store.searchTasks('read').map((t) => t.title)).toEqual([
      'Read someday',
      'Read new',
      'Read old'
    ])
  })

  it('treats % and _ as plain characters', () => {
    store.addTask({ title: '100% done' })
    store.addTask({ title: '1000 words' })
    store.addTask({ title: 'snake_case' })
    store.addTask({ title: 'snakeXcase' })

    expect(store.searchTasks('0%').map((t) => t.title)).toEqual(['100% done'])
    expect(store.searchTasks('e_c').map((t) => t.title)).toEqual(['snake_case'])
  })

  it('returns nothing for an empty search', () => {
    store.addTask({ title: 'Anything' })
    expect(store.searchTasks('  ')).toEqual([])
  })
})

describe('getDoneTasks', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns only finished tasks, most recently finished first, with when they were done', () => {
    store.addTask({ title: 'First', day: '2026-11-20' })
    store.addTask({ title: 'Second', day: '2026-11-20' })
    store.addTask({ title: 'Open', day: '2026-11-20' })
    const [first, second] = store.getTasksForDay('2026-11-20')

    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(2000)
    store.toggleTask(first.id)
    store.toggleTask(second.id)

    expect(store.getDoneTasks().map((t) => [t.title, t.doneAt])).toEqual([
      ['Second', 2000],
      ['First', 1000]
    ])
  })
})
