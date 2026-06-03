import { useState, useMemo } from 'react'
import { buildCostGrid, calculateScenarioCost, findOptimalMix, findOptimalSplitForFixedTotal, type LicenseScenario } from '../utils/licenseOptimization'
import { formatUsd } from '../utils/format'

type Props = {
  totalAicUnits: number
  currentBusinessSeats: number
  currentEnterpriseSeats: number
  userCount: number
  zeroAicUserCount: number
}

const RANGE_OPTIONS = [10, 25, 50, 100] as const

export function LicenseOptimizerView({ totalAicUnits, currentBusinessSeats, currentEnterpriseSeats, userCount, zeroAicUserCount }: Props) {
  const [selectedCell, setSelectedCell] = useState<LicenseScenario | null>(null)
  const [halfRange, setHalfRange] = useState(10)
  const [fixedTotalEnabled, setFixedTotalEnabled] = useState(false)
  const [fixedTotalInput, setFixedTotalInput] = useState<string>('')

  const fixedTotal = fixedTotalEnabled
    ? (Number(fixedTotalInput) > 0 ? Math.floor(Number(fixedTotalInput)) : currentBusinessSeats + currentEnterpriseSeats)
    : null

  const minTotalSeats = Math.max(userCount, currentBusinessSeats + currentEnterpriseSeats)

  const optimal = useMemo(
    () => findOptimalMix({ totalAicUnits, minTotalSeats }),
    [totalAicUnits, minTotalSeats],
  )

  // Grid is centered on the optimal mix so the most interesting area is always visible.
  // The current config may appear with a blue ring if it falls within range.
  const bMin = Math.max(0, optimal.businessSeats - halfRange)
  const bMax = optimal.businessSeats + halfRange
  const eMin = Math.max(0, optimal.enterpriseSeats - halfRange)
  const eMax = optimal.enterpriseSeats + halfRange

  const grid = useMemo(
    () => buildCostGrid({ totalAicUnits, businessRange: [bMin, bMax], enterpriseRange: [eMin, eMax] }),
    [totalAicUnits, bMin, bMax, eMin, eMax],
  )

  const currentScenario = useMemo(
    () => calculateScenarioCost({ businessSeats: currentBusinessSeats, enterpriseSeats: currentEnterpriseSeats, totalAicUnits }),
    [currentBusinessSeats, currentEnterpriseSeats, totalAicUnits],
  )

  const optimalScenario = useMemo(
    () => calculateScenarioCost({ businessSeats: optimal.businessSeats, enterpriseSeats: optimal.enterpriseSeats, totalAicUnits }),
    [optimal.businessSeats, optimal.enterpriseSeats, totalAicUnits],
  )

  const fixedTotalScenario = useMemo(
    () => fixedTotal !== null
      ? findOptimalSplitForFixedTotal({ totalAicUnits, totalSeats: fixedTotal })
      : null,
    [totalAicUnits, fixedTotal],
  )

  const displayCell = selectedCell ?? fixedTotalScenario ?? optimalScenario
  const businessCols = Array.from({ length: bMax - bMin + 1 }, (_, i) => bMin + i)

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">License Optimizer</h1>
        <p className="mt-1 text-sm text-gray-500">
          Find the Business/Enterprise seat mix that minimizes your monthly spend (license fees + AIC overage) for this report's usage.
        </p>
      </div>

      {/* Controls: fixed total toggle + range selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={fixedTotalEnabled}
            onChange={(e) => {
              setFixedTotalEnabled(e.target.checked)
              setSelectedCell(null)
              if (!e.target.checked) setFixedTotalInput('')
            }}
            className="rounded border-gray-300"
          />
          Fix total seats
        </label>
        {fixedTotalEnabled && (
          <input
            type="number"
            min={0}
            value={fixedTotalInput === '' ? (currentBusinessSeats + currentEnterpriseSeats) : fixedTotalInput}
            onChange={(e) => { setSelectedCell(null); setFixedTotalInput(e.target.value) }}
            className="border border-gray-300 rounded px-2 py-1 text-sm w-24 bg-white"
            aria-label="Total seats"
          />
        )}
        {fixedTotalEnabled && fixedTotalScenario && (
          <span className="text-sm text-gray-500">
            Best split for {fixedTotal} seats: {fixedTotalScenario.businessSeats}B + {fixedTotalScenario.enterpriseSeats}E
          </span>
        )}
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
          Minimum {minTotalSeats} seats required ({userCount.toLocaleString()} active users
          {minTotalSeats > userCount ? `, ${currentBusinessSeats + currentEnterpriseSeats} configured` : ''}).
        </p>
      </div>

      {zeroAicUserCount > 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm font-semibold text-blue-900">
            {zeroAicUserCount} of {userCount} user{userCount !== 1 ? 's' : ''} had zero AIC usage this period
          </p>
          <p className="text-sm text-blue-700 mt-1">
            These users don't consume AIC credits — a Business seat ($19/month) is the lowest-cost option for them.
            Consider whether they need Copilot at all.
          </p>
        </div>
      )}

      {/* Side-by-side breakdown: current config vs selected/recommended */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Current config</p>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Business seats" value={String(currentBusinessSeats)} />
            <Stat label="Enterprise seats" value={String(currentEnterpriseSeats)} />
            <Stat label="License cost" value={formatUsd(currentScenario.licenseCostUsd)} />
            <Stat label="AIC pool" value={currentScenario.poolSizeUnits.toLocaleString() + ' units'} />
            <Stat label="AIC overage" value={formatUsd(currentScenario.aicOverageUsd)} />
            <Stat label="Total/month" value={formatUsd(currentScenario.totalCostUsd)} highlighted />
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            {selectedCell ? 'Selected' : fixedTotalEnabled ? 'Fixed Total' : 'Recommended'}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Business seats" value={String(displayCell.businessSeats)} />
            <Stat label="Enterprise seats" value={String(displayCell.enterpriseSeats)} />
            <Stat label="License cost" value={formatUsd(displayCell.licenseCostUsd)} />
            <Stat label="AIC pool" value={displayCell.poolSizeUnits.toLocaleString() + ' units'} />
            <Stat label="AIC overage" value={formatUsd(displayCell.aicOverageUsd)} />
            <Stat
              label="Total/month"
              value={formatUsd(displayCell.totalCostUsd)}
              highlighted
              note={displayCell.totalCostUsd < currentScenario.totalCostUsd
                ? `saves ${formatUsd(currentScenario.totalCostUsd - displayCell.totalCostUsd)}/mo`
                : displayCell.totalCostUsd > currentScenario.totalCostUsd
                  ? `+${formatUsd(displayCell.totalCostUsd - currentScenario.totalCostUsd)}/mo`
                  : undefined
              }
            />
          </div>
        </div>
      </div>

      {/* Cost grid */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-700">
            Cost grid — click any cell to inspect. Green = cheaper than current, red = more expensive.
          </h2>
          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            Range ±
            <select
              value={halfRange}
              onChange={(e) => { setSelectedCell(null); setHalfRange(Number(e.target.value)) }}
              className="border border-gray-300 rounded px-1 py-0.5 text-xs bg-white"
            >
              {RANGE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            seats
          </label>
        </div>
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
                      const isFixedTotalMismatch = fixedTotal !== null && (b + e) !== fixedTotal

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
                            isFixedTotalMismatch ? 'opacity-30' : '',
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
          Blue ring = current configuration. Bold green = optimal.
          {fixedTotal !== null
            ? ` Dimmed cells don't sum to ${fixedTotal} total seats.`
            : ` Grid centered ±${halfRange} seats from optimal.`}
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
