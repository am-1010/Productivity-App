import { useCallback, useEffect, useState } from 'react'
import TodayView from './TodayView'
import { addDays, localDay, startOfWeek } from './day'
import type { Task } from '../../shared/types'

function App(): React.JSX.Element {
  // The current time, so the "now" line on the timeline stays live.
  const [now, setNow] = useState(() => {
    const d = new Date()
    return d.getHours() * 60 + d.getMinutes()
  })

  const [tasks, setTasks] = useState<Task[]>([])
  const [upcoming, setUpcoming] = useState<Task[]>([])
  const [view, setView] = useState<'today' | 'week'>('today')
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [week, setWeek] = useState<Task[]>([])

  const load = useCallback((): Promise<void> => {
    const today = localDay(new Date())
    return Promise.all([
      window.api.getTasks(today),
      window.api.getUpcomingTasks(today),
      // Starts a day early so a block that runs past midnight into Monday is included.
      window.api.getTasksForRange(localDay(addDays(weekStart, -1)), localDay(addDays(weekStart, 6)))
    ])
      .then(([todayTasks, upcomingTasks, weekTasks]) => {
        setTasks(todayTasks)
        setUpcoming(upcomingTasks)
        setWeek(weekTasks)
      })
      .catch((err) => console.error('Failed to load tasks', err))
  }, [weekStart])

  // Runs at startup, and again whenever the week view moves to another week.
  useEffect(() => {
    void load()
  }, [load])

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
      week={week}
      weekStart={weekStart}
      onChangeWeek={setWeekStart}
      activeNav={view}
      onNavigate={(key) => {
        if (key === 'today' || key === 'week') setView(key)
      }}
      counts={{
        today: tasks.filter((task) => !task.done).length,
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
