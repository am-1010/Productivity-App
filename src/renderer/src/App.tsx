import { useEffect, useState } from 'react'
import TodayView, { type Task } from './TodayView'

// Fake tasks just so we can SEE the design. Real data comes later from the database.
// Times are minutes-from-midnight: 11:30 is 11*60+30.
const SAMPLE_TASKS: Task[] = [
  { id: '1', title: 'Design review with Sam', project: 'OneView', start: 11 * 60 + 30, end: 12 * 60 + 15 },
  { id: '2', title: 'Deep work: OAuth spike', start: 14 * 60, end: 16 * 60 },
  { id: '3', title: 'Reply to Sam re: design', source: 'gmail' },
  { id: '4', title: 'Finish OAuth loopback script', project: 'OneView v1a' }
]

function App(): React.JSX.Element {
  // The current time, so the "now" line on the timeline stays live.
  const [now, setNow] = useState(() => {
    const d = new Date()
    return d.getHours() * 60 + d.getMinutes()
  })

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
      tasks={[]}
      counts={{ today: SAMPLE_TASKS.length, inbox: 0 }}
      nowMinutes={now}
    />
  )
}

export default App