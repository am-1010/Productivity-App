import { useCallback, useEffect, useState } from 'react'
import TodayView from './TodayView'
import { addDays, localDay, startOfWeek } from './day'
import type { CalendarEvent, Connection, Task } from '../../shared/types'

function App(): React.JSX.Element {
  // The current time, so the "now" line on the timeline stays live.
  const [now, setNow] = useState(() => {
    const d = new Date()
    return d.getHours() * 60 + d.getMinutes()
  })

  const [tasks, setTasks] = useState<Task[]>([])
  const [upcoming, setUpcoming] = useState<Task[]>([])
  const [overdue, setOverdue] = useState<Task[]>([])
  const [done, setDone] = useState<Task[]>([])
  const [view, setView] = useState<'today' | 'week' | 'search' | 'account'>('today')
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [week, setWeek] = useState<Task[]>([])
  const [todayEvents, setTodayEvents] = useState<CalendarEvent[]>([])
  const [weekEvents, setWeekEvents] = useState<CalendarEvent[]>([])
  const [connections, setConnections] = useState<Connection[]>([])

  const load = useCallback((): Promise<void> => {
    const today = localDay(new Date())
    return Promise.all([
      window.api.getTasks(today),
      window.api.getUpcomingTasks(today),
      window.api.getOverdueTasks(today),
      // Starts a day early so a block that runs past midnight into Monday is included.
      window.api.getTasksForRange(
        localDay(addDays(weekStart, -1)),
        localDay(addDays(weekStart, 6))
      ),
      window.api.getDoneTasks()
    ])
      .then(([todayTasks, upcomingTasks, overdueTasks, weekTasks, doneTasks]) => {
        setTasks(todayTasks)
        setUpcoming(upcomingTasks)
        setOverdue(overdueTasks)
        setWeek(weekTasks)
        setDone(doneTasks)
      })
      .catch((err) => console.error('Failed to load tasks', err))
  }, [weekStart])

  // Calendar events and connections. Loaded apart from tasks, so a calendar
  // problem never stops the task list from loading.
  const loadCalendars = useCallback((): Promise<void> => {
    const today = new Date()
    return Promise.all([
      // From yesterday, so a late event running past midnight shows on today.
      window.api.getEventsForRange(localDay(addDays(today, -1)), localDay(today)),
      window.api.getEventsForRange(
        localDay(addDays(weekStart, -1)),
        localDay(addDays(weekStart, 6))
      ),
      window.api.listConnections()
    ])
      .then(([todayList, weekList, connectionList]) => {
        setTodayEvents(todayList)
        setWeekEvents(weekList)
        setConnections(connectionList)
      })
      .catch((err) => console.error('Failed to load calendars', err))
  }, [weekStart])

  const searchTasks = useCallback((query: string) => window.api.searchTasks(query), [])

  // Runs at startup, and again whenever the week view moves to another week.
  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadCalendars()
  }, [loadCalendars])

  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date()
      setNow(d.getHours() * 60 + d.getMinutes())
    }, 30_000)
    return () => clearInterval(id)
  }, [])

  return (
    <TodayView
      date={new Date()}
      tasks={tasks}
      upcoming={upcoming}
      overdue={overdue}
      week={week}
      events={todayEvents}
      weekEvents={weekEvents}
      connections={connections}
      onRemoveConnection={(id) =>
        window.api
          .removeConnection(id)
          .then(loadCalendars)
          .catch((err) => console.error('Failed to remove connection', err))
      }
      onAddSampleCalendar={
        // The Sample calendar only exists while developing (npm run dev).
        import.meta.env.DEV
          ? () =>
              window.api
                .addSampleCalendar()
                .then(loadCalendars)
                .catch((err) => console.error('Failed to add sample calendar', err))
          : undefined
      }
      done={done}
      onSearch={searchTasks}
      weekStart={weekStart}
      onChangeWeek={setWeekStart}
      activeNav={view}
      onNavigate={(key) => {
        setView(key)
      }}
      counts={{
        today: tasks.filter((task) => !task.done).length,
        overdue: overdue.length,
        inbox: 0,
        upcoming: upcoming.filter((task) => !task.done).length
      }}
      nowMinutes={now}
      // No .catch here on purpose: the error goes back to the form so it can show it.
      onNewTask={(input) => window.api.addTask(input).then(load)}
      onUpdateTask={(id, input) => window.api.updateTask(id, input).then(load)}
      onToggleTask={(id) =>
        window.api
          .toggleTask(id)
          .then(load)
          .catch((err) => console.error('Failed to update task', err))
      }
      onDeleteTask={(id) =>
        window.api
          .deleteTask(id)
          .then(load)
          .catch((err) => console.error('Failed to delete task', err))
      }
    />
  )
}

export default App
