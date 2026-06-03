import { useState, useMemo } from 'react'
import { buildCostGrid, calculateScenarioCost, findOptimalMix, type LicenseScenario } from '../utils/licenseOptimization'
import { formatUsd } from '../utils/format'

type Props = {
  totalAicUnits: number
  currentBusinessSeats: number
  currentEnterpriseSeats: number
  userCount: number
}

const GRID_HALF_RANGE = 10

export function LicenseOptimizerView({ totalAicUnits, currentBusinessSeats, currentEnterpriseSeats, userCount }: Props) {
  const [selectedCell, setSelectedCell] = useState<LicenseScenario | null>(null)

  const bMin = Math.max(0, currentBusinessSeats - GRID_HALF_RANGE)
  const bMax = currentBusinessSeats + GRID_HALF_RANGE
  const eMin = Math.max(0, currentEnterpriseSeats - GRID_HALF_RANGE)
  const eMax = currentEnterpriseSeats + GRID_HALF_RANGE

  const grid = useMemo(
    () => buildCostGrid({ totalAicUnits, businessRange: [bMin, bMax], enterpriseRange: [eMin, eMax] }),
    [totalAicUnits, bMin, bMax, eMin, eMax],
  )

  const optimal = useMemo(
    () => findOptimalMix({ totalAicUnits, minTotalSeats: userCount }),
    [totalAicUnits, userCount],
  )

  const currentScenario = useMemo(
    () => calculateScenarioCost({ businessSeats: currentBusinessSeats, enterpriseSeats: currentEnterpriseSeats, totalAicUnits }),
    [currentBusinessSeats, currentEnterpriseSeats, totalAicUnits],
  )

  const allCosts = grid.flat().map((c) => c.totalCostUsd)
  const minCost = Math.min(...allCosts)
  const maxCost = Math.max(...allCosts)

  const displayCell = selectedCell ?? currentScenario
  const businessCols = Array.from({ length: bMax - bMin + 1 }, (_, i) => bMin + i)
  const enterpriseRows = Array.from({ length: eMax - eMin + 1 }, (_, i) => eMin + i)

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">License Optimizer</h1>
        <p className="mt-1 text-sm text-gray-500">
          Find the Business/Enterprise seat mix that minimizes your monthly spend (license fees + AIC overage) for this report's usage.
        </p>
      </div>

      {/* Optimal recommendation */}
      <div className="rounded-lg border border-green-300 bg-green-50 p-4">
        <h2 className="text-sm font-semibold text-green-900 uppercase tracking-wide">Recommended mix</h2>
        <p className="mt-1 text-lg font-bold text-green-800">
          {optimal.businessSeats} Business + {optimal.enterpriseSeats} Enterprise
          {' '}→ {formatUsd(optimal.totalCostUsd)}/month
        </p>
        <p className="text-sm text-green-700">
          License: {formatUsd(optimal.licenseCostUsd)} · AIC overage: {formatUsd(optimal.aicOverageUsd)}
          {optimal.totalCostUsd < currentScenario.totalCostUsd && (
            <span className="ml-2 font-medium">
              (saves {formatUsd(currentScenario.totalCostUsd - optimal.totalCostUsd)}/month vs current)
            </span>
          )}
        </p>
        <p className="text-xs text-green-600 mt-1">
          Minimum {userCount} seats required to cover all {userCount.toLocaleString()} users.
        </p>
      </div>

      {/* Selected/current combination breakdown */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="Business seats" value={String(displayCell.businessSeats)} />
        <Stat label="Enterprise seats" value={String(displayCell.enterpriseSeats)} />
        <Stat label="License cost" value={formatUsd(displayCell.licenseCostUsd)} />
        <Stat label="AIC pool" value={displayCell.poolSizeUnits.toLocaleString() + ' units'} />
        <Stat label="AIC usage" value={totalAicUnits.toLocaleString() + ' units'} />
        <Stat label="AIC overage" value={formatUsd(displayCell.aicOverageUsd)} />
        <Stat label="Total/month" value={formatUsd(displayCell.totalCostUsd)} highlighted />
        <Stat
          label="vs current"
          value={displayCell === currentScenario
            ? '—'
            : formatUsd(Math.abs(displayCell.totalCostUsd - currentScenario.totalCostUsd))
          }
          note={displayCell !== currentScenario
            ? displayCell.totalCostUsd < currentScenario.totalCostUsd ? 'cheaper' : 'more expensive'
            : undefined
          }
        />
      </div>

      {/* Cost grid */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-2">
          Cost grid — click any cell to inspect. Green = cheaper than current, red = more expensive.
        </h2>
        <div className="overflow-auto border border-gray-200 rounded-lg">
          <table className="text-xs border-collapse min-w-max">
            <thead>
              <tr>
                <th className="sticky left-0 bg-gray-100 px-2 py-1 text-right text-gray-500 border-b border-r border-gray-200">
                  Ent ↓ / Biz →
                </th>
                {businessCols.map((b) => (
                  <th key={b} className="px-2 py-1 text-center font-medium bg-gray-50 border-b border-gray-200 min-w-[64px]">
                    {b}B
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map((row, eIdx) => {
                const e = eMin + eIdx
                return (
                  <tr key={e}>
                    <th className="sticky left-0 bg-gray-100 px-2 py-1 text-right font-medium text-gray-600 border-r border-gray-200">
                      {e}E
                    </th>
                    {row.map((cell, bIdx) => {
                      const b = bMin + bIdx
                      const isCurrent = b === currentBusinessSeats && e === currentEnterpriseSeats
                      const isSelected = selectedCell?.businessSeats === b && selectedCell?.enterpriseSeats === e

                      let colorClass = 'bg-white'
                      if (cell.isOptimal) {
                        colorClass = 'bg-green-200'
                      } else if (cell.totalCostUsd < currentScenario.totalCostUsd) {
                        colorClass = 'bg-green-50'
                      } else if (cell.totalCostUsd > currentScenario.totalCostUsd) {
                        colorClass = 'bg-red-50'
                      }

                      return (
                        <td
                          key={b}
                          onClick={() => setSelectedCell(cell)}
                          className={[
                            'px-2 py-1 text-center cursor-pointer border border-gray-100 transition-colors',
                            colorClass,
                            isCurrent ? 'ring-2 ring-blue-500 ring-inset font-bold' : '',
                            isSelected ? 'ring-2 ring-indigo-400 ring-inset' : '',
                            'hover:bg-indigo-50',
                          ].join(' ')}
                          title={`${b} Business + ${e} Enterprise: ${formatUsd(cell.totalCostUsd)}/month`}
                        >
                          {formatUsd(cell.totalCostUsd)}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-xs text-gray-400">
          Blue ring = current configuration. Bold green = optimal. Grid centered ±{GRID_HALF_RANGE} seats from current.
        </p>
      </div>
    </div>
  )
}

function Stat({ label, value, highlighted, note }: { label: string; value: string; highlighted?: boolean; note?: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-base font-semibold ${highlighted ? 'text-indigo-700' : 'text-gray-900'}`}>{value}</p>
      {note && <p className="text-xs text-gray-400">{note}</p>}
    </div>
  )
}
