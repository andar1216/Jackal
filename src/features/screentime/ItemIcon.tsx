import { useState } from 'react'
import { screenTimeApi } from '../../lib/api'

/**
 * A site's favicon or an app's icon. When there's no picture, a coloured tile with the first letter instead.
 * `source="phone"` is for an app on the phone, whose picture was sent by the phone.
 */
export default function ItemIcon({ kind, name, label, source }: { kind: 'site' | 'app'; name: string; label: string; source?: 'phone' }) {
  const [failed, setFailed] = useState(false)
  if (!failed) {
    return (
      <img
        className="item-icon"
        src={screenTimeApi.iconUrl(kind, name, source)}
        alt=""
        width={20}
        height={20}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    )
  }
  let hue = 0
  for (const c of label) hue = (hue * 31 + c.charCodeAt(0)) % 360
  return (
    <span className="item-icon item-icon-letter" style={{ background: `hsl(${hue} 45% 45%)` }} aria-hidden>
      {label.trim().charAt(0).toUpperCase()}
    </span>
  )
}
