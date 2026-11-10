import { useEffect, useState } from 'react'
import TodayView, { type Task } from './TodayView'

/** Local calendar day as 'YYYY-MM-DD'. Not toISOString(), which is UTC. */
const localDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function App(): React.JSX.Element {
  // The current time, so the "now" line on the timeline stays live.
  const [now, setNow] = useState(() => {
    const d = new Date()
    return d.getHours() * 60 + d.getMinutes()
  })

  const [tasks, setTasks] = useState<Task[]>([])
  const [upcoming, setUpcoming] = useState<Task[]>([])

  const load = (): Promise<void> => {
    const today = localDay(new Date())
    return Promise.all([window.api.getTasks(today), window.api.getUpcomingTasks(today)])
      .then(([todayTasks, upcomingTasks]) => {
        setTasks(todayTasks)
        setUpcoming(upcomingTasks)
      })
      .catch((err) => console.error('Failed to load tasks', err))
  }

  useEffect(() => {
    void load()
  }, [])

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
      counts={{
        today: tasks.filter((task) => !task.done).length,
        inbox: 0,
        upcoming: upcoming.filter((task) => !task.done).length
      }}
      nowMinutes={now}
      // No .catch here on purpose: the error goes back to the form so it can show it.
      onNewTask={(input) => window.api.addTask(input).then(load)}
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
