import { Settings } from 'lucide-react'
import MenuButton, { type MenuItem } from './MenuButton'

/** The gear at the far side of a page's title row. Its dropdown holds that page's settings. */
export default function SettingsMenu({ items }: { items: MenuItem[] }) {
  return <MenuButton label="Page settings" icon={<Settings size={18} />} items={items} />
}