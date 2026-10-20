import { useMemo } from 'react'
import { geoAlbersUsa, geoCentroid, geoPath } from 'd3-geo'
import { feature, mesh } from 'topojson-client'
import type { FeatureCollection, Geometry } from 'geojson'
import type { GeometryCollection, Topology } from 'topojson-specification'
import states from 'us-atlas/states-10m.json'
import type { GamedayStop, Team } from '../../data/types'
import { placeKey, placeLabel, stateCode, STATE_CODES } from './data'

// The US map ships with the app (us-atlas TopoJSON); no map service is used.
const topology = states as unknown as Topology<{ states: GeometryCollection<{ name: string }> }>
const stateShapes = feature(topology, topology.objects.states) as FeatureCollection<Geometry, { name: string }>
const borders = mesh(topology, topology.objects.states, (a, b) => a !== b)
const WIDTH = 960
const HEIGHT = 600
const projection = geoAlbersUsa().scale(1280).translate([WIDTH / 2, HEIGHT / 2])
const path = geoPath(projection)
const centroids = new Map(stateShapes.features.map((shape) => [STATE_CODES[shape.properties.name] ?? shape.properties.name, geoCentroid(shape)]))

export type MapPoint = { key: string; label: string; count: number; x: number; y: number; highlight: boolean }

const numberOf = (value: unknown) => (typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN)

// Coordinates for a show: the host's campus when the show was there, any
// stored team venue in the same city, else the middle of the state.
export function useMapPoints(stops: GamedayStop[], teams: Team[], highlightKey?: string | null) {
  return useMemo(() => {
    const byCity = new Map<string, [number, number]>()
    for (const team of teams) {
      const lat = numberOf(team.location?.latitude)
      const lon = numberOf(team.location?.longitude)
      if (!team.location?.city || !Number.isFinite(lat) || !Number.isFinite(lon)) continue
      const key = `${team.location.city.toLowerCase()}|${stateCode(team.location.state)}`
      if (!byCity.has(key)) byCity.set(key, [lon, lat])
    }
    const points = new Map<string, MapPoint>()
    for (const stop of stops) {
      const key = placeKey(stop)
      const existing = points.get(key)
      if (existing) {
        existing.count += 1
        continue
      }
      const coordinates = byCity.get(key) ?? centroids.get(stateCode(stop.state))
      const projected = coordinates ? projection(coordinates) : null
      if (!projected) continue
      points.set(key, { key, label: placeLabel(stop), count: 1, x: projected[0], y: projected[1], highlight: key === highlightKey })
    }
    return [...points.values()].sort((a, b) => b.count - a.count)
  }, [stops, teams, highlightKey])
}

export default function GameDayMap({ stops, teams, highlightKey = null, small = false }: { stops: GamedayStop[]; teams: Team[]; highlightKey?: string | null; small?: boolean }) {
  const points = useMapPoints(stops, teams, highlightKey)
  const max = Math.max(1, ...points.map((point) => point.count))
  return (
    <svg className={`gd-map${small ? ' small' : ''}`} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Map of GameDay locations">
      <path d={path(stateShapes) ?? ''} className="gd-land" />
      <path d={path(borders) ?? ''} className="gd-borders" />
      {points.map((point) => (
        <circle
          key={point.key}
          cx={point.x}
          cy={point.y}
          r={small ? 7 : 6 + 16 * Math.sqrt(point.count / max)}
          className={`gd-pin${point.highlight ? ' highlight' : ''}`}
        >
          <title>{`${point.label} · ${point.count} ${point.count === 1 ? 'show' : 'shows'}`}</title>
        </circle>
      ))}
    </svg>
  )
}
