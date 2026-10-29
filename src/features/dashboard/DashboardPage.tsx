import ConnectorsButton from '../connections/ConnectorsButton'

export default function DashboardPage() {
  return (
    <>
      <header className="page-header row between">
        <div>
          <h1>Dashboard</h1>
          <p>Your overview will live here. Habits, finances, diet and fitness each have their own page.</p>
        </div>
        <ConnectorsButton title="Connectors" />
      </header>
    </>
  )
}