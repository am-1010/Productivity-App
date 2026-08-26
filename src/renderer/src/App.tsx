import { useEffect, useState } from 'react'
import TodayView, { type Task } from './TodayView'

function App(): React.JSX.Element {
  // The current time, so the "now" line on the timeline stays live.
  const [now, setNow] = useState(() => {
    const d = new Date()
    return d.getHours() * 60 + d.getMinutes()
  })

  const [tasks, setTasks] = useState<Task[]>([])

  const load = (): void => {
    window.api.getTasks().then(setTasks)
  }

  useEffect(() => {
    load()
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
      counts={{ today: tasks.length, inbox: 0 }}
      nowMinutes={now}
      onNewTask={() => window.api.addTask('New task').then(load)}
      onToggleTask={(id) => window.api.toggleTask(id).then(load)}
    />
  )
}

export default App