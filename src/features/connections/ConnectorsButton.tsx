import { useCallback, useState } from 'react'
import { Plug } from 'lucide-react'
import type { Integration } from '../../types'
import ConnectModal from './ConnectModal'

type Props = {
  /** Which connectors this page lists. Everything, if left out. */
  filter?: (item: Integration) => boolean
  /** Heading of the dialog, for example "Finance connectors". */
  title?: string
}

/** The Connectors button for a page's header. It opens the connectors that belong to that page. */
export default function ConnectorsButton({ filter, title }: Props) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])

  return (
    <>
      <button className="primary" onClick={() => setOpen(true)}>
        <span className="row" style={{ gap: 6 }}>
          <Plug size={16} aria-hidden />
          Connectors
        </span>
      </button>
      {open && <ConnectModal onClose={close} filter={filter} title={title} />}
    </>
  )
}
