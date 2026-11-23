import { createRoot } from 'react-dom/client'
import { Admin } from './Admin'
import { Participant } from './Participant'
import './styles.css'

const path = window.location.pathname.replace(/\/+$/, '') || '/'
const match = path.match(/^\/s\/([a-z0-9-]+)$/)

function App() {
  if (path === '/admin' || path.startsWith('/admin/')) return <Admin path={path} />
  if (match) return <Participant slug={match[1]} />
  return <main className="participant">
    <section className="state-panel">
      <h1>Dust Survey</h1>
      <p>Open the survey link you were given to get started.</p>
    </section>
  </main>
}

createRoot(document.getElementById('root')!).render(<App />)
