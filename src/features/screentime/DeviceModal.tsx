import { useEffect, type ReactNode } from 'react'

/** A dialog for one device (or for adding one). Closes with the X, Escape, or a click outside it. */
export default function DeviceModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row between">
          <h2>{title}</h2>
          <button className="link" onClick={onClose} aria-label="Close" autoFocus>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
