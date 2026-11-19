import { MapView } from './map'
import { Legend, SidePanel } from './ui'

export default function App() {
  return (
    <div className="app">
      <MapView />
      <SidePanel />
      <Legend />
    </div>
  )
}
