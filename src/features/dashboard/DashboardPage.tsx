import Board, { Panel } from '../../components/Board'
import { usePublishedPanels } from '../../components/panelStore'
import PanelFilter from '../../components/PanelFilter'
import SettingsMenu from '../../components/SettingsMenu'
import { useLayoutEditing } from '../../components/useLayoutEditing'
import ConnectorsButton from '../connections/ConnectorsButton'

/**
 * Any panel from the other pages can be added here. It is the page's own panel, drawn from the same
 * data, so whatever changes there changes here (and the other way round).
 */
export default function DashboardPage({ pageLabels }: { pageLabels: Record<string, string> }) {
  const layout = useLayoutEditing()
  const available = usePublishedPanels()

  return (
    <>
      <header className="page-header row between">
        <div>
          <h1>Dashboard</h1>
          <p>Pin widgets from your other pages here. They are the same widgets, so they stay up to date.</p>
        </div>
        <div className="row">
          <PanelFilter page="dashboard" />
          <ConnectorsButton title="Connectors" />
          <SettingsMenu
            items={[{ label: layout.editing ? 'Done customizing' : 'Add or arrange widgets', onSelect: layout.item.onSelect }]}
          />
        </div>
      </header>

      <Board
        page="dashboard"
        publish={false}
        editing={layout.editing}
        onEditingChange={layout.setEditing}
        emptyText="No widgets yet. Open the settings gear, choose Add or arrange widgets, then pick one from + Add panel."
      >
        {available.map((p) => (
          <Panel
            key={`${p.page}/${p.id}`}
            id={`${p.page}/${p.id}`}
            title={`${pageLabels[p.page] ?? p.page}: ${p.title}`}
            size={p.size}
            defaultHidden
          >
            {p.node}
          </Panel>
        ))}
      </Board>
    </>
  )
}
