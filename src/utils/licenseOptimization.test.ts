import { describe, it, expect } from 'vitest'
import {
  calculateScenarioCost,
  findOptimalMix,
  buildCostGrid,
  findOptimalSplitForFixedTotal,
  calculateBreakEven,
} from './licenseOptimization'

// 1000 business users, each using 4 AIC units/month = 4000 total AIC units
const Q = 4_000

describe('calculateScenarioCost', () => {
  it('returns license-only cost when pool covers all AIC usage', () => {
    // 2 enterprise seats: pool = 14,000 AIC units > 4,000
    const result = calculateScenarioCost({ businessSeats: 0, enterpriseSeats: 2, totalAicUnits: Q })
    expect(result.licenseCostUsd).toBeCloseTo(78)      // 2 × $39
    expect(result.aicOverageUsd).toBeCloseTo(0)
    expect(result.totalCostUsd).toBeCloseTo(78)
  })

  it('adds AIC overage when pool is smaller than usage', () => {
    // 0 seats: pool = 0, full AIC is overage at $0.01/unit
    const result = calculateScenarioCost({ businessSeats: 0, enterpriseSeats: 0, totalAicUnits: Q })
    expect(result.licenseCostUsd).toBeCloseTo(0)
    expect(result.aicOverageUsd).toBeCloseTo(40)       // 4000 × $0.01
    expect(result.totalCostUsd).toBeCloseTo(40)
  })

  it('partially offsets overage when pool covers some usage', () => {
    // 1 business seat: pool = 3000 AIC units; 1000 units remain as overage
    const result = calculateScenarioCost({ businessSeats: 1, enterpriseSeats: 0, totalAicUnits: Q })
    expect(result.licenseCostUsd).toBeCloseTo(19)
    expect(result.poolSizeUnits).toBe(3000)
    expect(result.aicOverageUnits).toBe(1000)
    expect(result.aicOverageUsd).toBeCloseTo(10)       // 1000 × $0.01
    expect(result.totalCostUsd).toBeCloseTo(29)
  })

  it('returns savings vs zero-license baseline', () => {
    const baseline = calculateScenarioCost({ businessSeats: 0, enterpriseSeats: 0, totalAicUnits: Q })
    const scenario = calculateScenarioCost({ businessSeats: 1, enterpriseSeats: 0, totalAicUnits: Q })
    expect(scenario.savingsVsBaselineUsd).toBeCloseTo(baseline.totalCostUsd - scenario.totalCostUsd)
  })
})

describe('findOptimalMix', () => {
  it('prefers enterprise seats for AIC efficiency when unconstrained', () => {
    // No min-seat constraint: pure AIC coverage optimization
    // ceil(4000 / 7000) = 1 enterprise seat covers it all for $39 (vs $40 overage)
    const result = findOptimalMix({ totalAicUnits: Q, minTotalSeats: 0 })
    expect(result.enterpriseSeats).toBe(1)
    expect(result.businessSeats).toBe(0)
    expect(result.totalCostUsd).toBeLessThan(40) // beats paying overage
  })

  it('satisfies minimum seat constraint when users exceed optimal AIC seats', () => {
    // 10 users, 4000 AIC units: 1 enterprise covers AIC but we need 10 seats total
    const result = findOptimalMix({ totalAicUnits: Q, minTotalSeats: 10 })
    expect(result.enterpriseSeats + result.businessSeats).toBeGreaterThanOrEqual(10)
  })

  it('does not add seats beyond break-even when overage is already zero', () => {
    // Already covered: optimal is the minimum seats
    const result = findOptimalMix({ totalAicUnits: 0, minTotalSeats: 5 })
    expect(result.enterpriseSeats + result.businessSeats).toBe(5)
    // $39 > $19, so prefer business for minimum seats
    expect(result.businessSeats).toBe(5)
    expect(result.enterpriseSeats).toBe(0)
  })
})

describe('buildCostGrid', () => {
  it('returns a 2D array of scenario costs indexed [enterpriseRow][businessCol]', () => {
    const grid = buildCostGrid({
      totalAicUnits: Q,
      businessRange: [0, 2],
      enterpriseRange: [0, 2],
    })
    expect(grid).toHaveLength(3)            // 0, 1, 2 enterprise rows
    expect(grid[0]).toHaveLength(3)          // 0, 1, 2 business cols
    expect(grid[0][0].businessSeats).toBe(0)
    expect(grid[0][0].enterpriseSeats).toBe(0)
    expect(grid[2][1].businessSeats).toBe(1)
    expect(grid[2][1].enterpriseSeats).toBe(2)
  })

  it('marks the minimum cost cell', () => {
    const grid = buildCostGrid({
      totalAicUnits: Q,
      businessRange: [0, 3],
      enterpriseRange: [0, 3],
    })
    const minCells = grid.flat().filter((c) => c.isOptimal)
    expect(minCells.length).toBeGreaterThanOrEqual(1)
    const minCost = Math.min(...grid.flat().map((c) => c.totalCostUsd))
    expect(minCells[0].totalCostUsd).toBeCloseTo(minCost)
  })
})

describe('findOptimalSplitForFixedTotal', () => {
  it('finds the cheapest B/E split for exactly N seats', () => {
    // 4000 AIC units, 10 seats total
    // All-business: 10B+0E = pool 30000, no overage, cost = 10*$19 = $190
    // 1E+9B: pool 7000+27000=34000, no overage, cost = $39+9*$19 = $210
    // → all-business wins
    const result = findOptimalSplitForFixedTotal({ totalAicUnits: Q, totalSeats: 10 })
    expect(result.businessSeats + result.enterpriseSeats).toBe(10)
    expect(result.isOptimal).toBe(true)
    expect(result.totalCostUsd).toBeLessThanOrEqual(190)
  })

  it('returns correct zero-seat edge case', () => {
    const result = findOptimalSplitForFixedTotal({ totalAicUnits: Q, totalSeats: 0 })
    expect(result.businessSeats).toBe(0)
    expect(result.enterpriseSeats).toBe(0)
    expect(result.aicOverageUsd).toBeCloseTo(40) // 4000 * $0.01
  })

  it('always returns a scenario where B+E equals totalSeats', () => {
    const result = findOptimalSplitForFixedTotal({ totalAicUnits: Q, totalSeats: 5 })
    expect(result.businessSeats + result.enterpriseSeats).toBe(5)
  })

  it('prefers Enterprise when AIC usage is high relative to the single seat', () => {
    // totalSeats=1, totalAicUnits=8000
    // 1B: $19 + (8000-3000)*$0.01 = $19 + $50 = $69
    // 1E: $39 + (8000-7000)*$0.01 = $39 + $10 = $49  ← cheaper
    const result = findOptimalSplitForFixedTotal({ totalAicUnits: 8000, totalSeats: 1 })
    expect(result.enterpriseSeats).toBe(1)
    expect(result.businessSeats).toBe(0)
    expect(result.totalCostUsd).toBeCloseTo(49)
  })
})

describe('calculateBreakEven', () => {
  it('returns correct business break-even units', () => {
    const be = calculateBreakEven()
    // $19 / $0.01 = 1900 AIC units
    expect(be.businessBreakEvenUnits).toBe(1900)
  })

  it('returns correct enterprise break-even units', () => {
    const be = calculateBreakEven()
    // $39 / $0.01 = 3900 AIC units
    expect(be.enterpriseBreakEvenUnits).toBe(3900)
  })

  it('returns correct enterprise-vs-business marginal break-even', () => {
    const be = calculateBreakEven()
    // ($39 - $19) / $0.01 = 2000 additional AIC units to prefer Enterprise over Business
    expect(be.enterpriseVsBusinessBreakEvenUnits).toBe(2000)
  })
})
