import FilterMenu from './FilterMenu'
import { useBoardControl } from './panelStore'

/** A page's filter icon: show all, some or none of the panels on that page. */
export default function PanelFilter({ page }: { page: string }) {
  const board = useBoardControl(page)
  if (!board || board.panels.length === 0) return null
  return (
    <FilterMenu
      label="Choose panels"
      heading="Show on this page"
      options={board.panels.map((p) => ({ id: p.id, label: p.title }))}
      selected={board.panels.filter((p) => !p.hidden).map((p) => p.id)}
      onChange={board.setShown}
    />
  )
}