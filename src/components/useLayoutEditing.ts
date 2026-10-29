import { useState } from 'react'
import type { MenuItem } from './MenuButton'

/** Whether a page's layout is being rearranged, plus the settings-menu entry that switches it. */
export function useLayoutEditing() {
  const [editing, setEditing] = useState(false)
  const item: MenuItem = {
    label: editing ? 'Done customizing' : 'Customize layout',
    onSelect: () => setEditing((e) => !e),
  }
  return { editing, setEditing, item }
}