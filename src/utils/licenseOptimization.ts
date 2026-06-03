import {
  BUSINESS_MONTHLY_AIC_INCLUDED_CREDITS,
  ENTERPRISE_MONTHLY_AIC_INCLUDED_CREDITS,
} from '../pipeline/aicIncludedCredits'
import { AIC_UNIT_PRICE_USD } from './billingConstants'

const BUSINESS_LICENSE_MONTHLY_COST = 19
const ENTERPRISE_LICENSE_MONTHLY_COST = 39

export type LicenseScenarioInput = {
  businessSeats: number
  enterpriseSeats: number
  totalAicUnits: number
}

export type LicenseScenario = LicenseScenarioInput & {
  poolSizeUnits: number
  licenseCostUsd: number
  aicOverageUnits: number
  aicOverageUsd: number
  totalCostUsd: number
  savingsVsBaselineUsd: number
  isOptimal: boolean
}

function baselineCostUsd(totalAicUnits: number): number {
  return totalAicUnits * AIC_UNIT_PRICE_USD
}

export function calculateScenarioCost(input: LicenseScenarioInput): LicenseScenario {
  const { businessSeats, enterpriseSeats, totalAicUnits } = input
  const poolSizeUnits =
    businessSeats * BUSINESS_MONTHLY_AIC_INCLUDED_CREDITS +
    enterpriseSeats * ENTERPRISE_MONTHLY_AIC_INCLUDED_CREDITS
  const aicOverageUnits = Math.max(0, totalAicUnits - poolSizeUnits)
  const aicOverageUsd = aicOverageUnits * AIC_UNIT_PRICE_USD
  const licenseCostUsd =
    businessSeats * BUSINESS_LICENSE_MONTHLY_COST +
    enterpriseSeats * ENTERPRISE_LICENSE_MONTHLY_COST
  const totalCostUsd = licenseCostUsd + aicOverageUsd
  const savingsVsBaselineUsd = baselineCostUsd(totalAicUnits) - totalCostUsd

  return {
    ...input,
    poolSizeUnits,
    licenseCostUsd,
    aicOverageUnits,
    aicOverageUsd,
    totalCostUsd,
    savingsVsBaselineUsd,
    isOptimal: false,
  }
}

export type OptimalMixInput = {
  totalAicUnits: number
  minTotalSeats: number
}

export type OptimalMix = {
  businessSeats: number
  enterpriseSeats: number
  totalCostUsd: number
  licenseCostUsd: number
  aicOverageUsd: number
}

export function findOptimalMix({ totalAicUnits, minTotalSeats }: OptimalMixInput): OptimalMix {
  let businessSeats = 0
  let enterpriseSeats = 0
  let remainingAic = totalAicUnits

  // Add Enterprise seats while AIC savings exceed the seat cost
  while (remainingAic > ENTERPRISE_LICENSE_MONTHLY_COST / AIC_UNIT_PRICE_USD) {
    enterpriseSeats += 1
    remainingAic = Math.max(0, remainingAic - ENTERPRISE_MONTHLY_AIC_INCLUDED_CREDITS)
  }

  // Add Business seats while AIC savings exceed the seat cost
  while (remainingAic > BUSINESS_LICENSE_MONTHLY_COST / AIC_UNIT_PRICE_USD) {
    businessSeats += 1
    remainingAic = Math.max(0, remainingAic - BUSINESS_MONTHLY_AIC_INCLUDED_CREDITS)
  }

  // Satisfy minimum seat constraint with the cheaper license (Business)
  const totalSeatsNow = businessSeats + enterpriseSeats
  if (totalSeatsNow < minTotalSeats) {
    businessSeats += minTotalSeats - totalSeatsNow
  }

  const scenario = calculateScenarioCost({ businessSeats, enterpriseSeats, totalAicUnits })
  return {
    businessSeats,
    enterpriseSeats,
    totalCostUsd: scenario.totalCostUsd,
    licenseCostUsd: scenario.licenseCostUsd,
    aicOverageUsd: scenario.aicOverageUsd,
  }
}

export type BuildGridInput = {
  totalAicUnits: number
  businessRange: [min: number, max: number]
  enterpriseRange: [min: number, max: number]
}

export function buildCostGrid({ totalAicUnits, businessRange, enterpriseRange }: BuildGridInput): LicenseScenario[][] {
  const [bMin, bMax] = businessRange
  const [eMin, eMax] = enterpriseRange

  const grid: LicenseScenario[][] = []
  let globalMin = Infinity

  for (let e = eMin; e <= eMax; e++) {
    const row: LicenseScenario[] = []
    for (let b = bMin; b <= bMax; b++) {
      const scenario = calculateScenarioCost({ businessSeats: b, enterpriseSeats: e, totalAicUnits })
      if (scenario.totalCostUsd < globalMin) globalMin = scenario.totalCostUsd
      row.push(scenario)
    }
    grid.push(row)
  }

  for (const row of grid) {
    for (const cell of row) {
      cell.isOptimal = Math.abs(cell.totalCostUsd - globalMin) < 0.001
    }
  }

  return grid
}

export type FixedTotalSplitInput = {
  totalAicUnits: number
  totalSeats: number
}

export function findOptimalSplitForFixedTotal({ totalAicUnits, totalSeats }: FixedTotalSplitInput): LicenseScenario {
  if (totalSeats === 0) {
    return { ...calculateScenarioCost({ businessSeats: 0, enterpriseSeats: 0, totalAicUnits }), isOptimal: true }
  }

  let best: LicenseScenario | null = null
  for (let e = 0; e <= totalSeats; e++) {
    const b = totalSeats - e
    const scenario = calculateScenarioCost({ businessSeats: b, enterpriseSeats: e, totalAicUnits })
    if (!best || scenario.totalCostUsd < best.totalCostUsd) {
      best = scenario
    }
  }

  return { ...best!, isOptimal: true }
}

export type BreakEven = {
  businessBreakEvenUnits: number
  enterpriseBreakEvenUnits: number
  enterpriseVsBusinessBreakEvenUnits: number
}

export function calculateBreakEven(): BreakEven {
  return {
    businessBreakEvenUnits: BUSINESS_LICENSE_MONTHLY_COST / AIC_UNIT_PRICE_USD,
    enterpriseBreakEvenUnits: ENTERPRISE_LICENSE_MONTHLY_COST / AIC_UNIT_PRICE_USD,
    enterpriseVsBusinessBreakEvenUnits: (ENTERPRISE_LICENSE_MONTHLY_COST - BUSINESS_LICENSE_MONTHLY_COST) / AIC_UNIT_PRICE_USD,
  }
}
