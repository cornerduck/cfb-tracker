import { useState } from 'react'
import { imageUrl } from '../../shared/ui'

// NFL logo plate. Logos are own files in public/images/nfl/<abbreviation>.png;
// without a file the plate shows the abbreviation in the team color.
export function NflPlate({ abbr, color, size = 30 }: { abbr: string; color: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  const src = imageUrl('nfl', abbr.toLowerCase(), ['png', 'webp', 'svg'])
  const fontSize = Math.max(7, Math.min(size * 0.46, 16) - Math.max(0, abbr.length - 3) * size * 0.08)
  return (
    <span className="plate" style={{ width: size, height: size, borderRadius: Math.max(4, size * 0.2), color: `#${color}`, fontSize }} aria-hidden="true">
      {src && !failed ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} /> : <span className="plate-text">{abbr}</span>}
    </span>
  )
}
