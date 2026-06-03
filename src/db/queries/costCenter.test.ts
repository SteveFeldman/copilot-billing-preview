import { describe, it, expect, afterEach } from 'vitest'
import { getDb, resetDb } from '../duckdb'
import { createUsageTable, appendRow } from '../appender'
import { queryCostCenters } from './costCenter'
import type { TokenUsageRecord } from '../../pipeline/parser'

function makeRecord(overrides: Partial<TokenUsageRecord> = {}): TokenUsageRecord {
  return {
    date: '2026-05-01', username: 'mona', product: 'copilot',
    sku: 'copilot_premium_request', model: 'GPT-5', quantity: 1,
    unit_type: 'requests', applied_cost_per_quantity: 0.04,
    gross_amount: 0.04, discount_amount: 0.01, net_amount: 0.03,
    exceeds_quota: false, total_monthly_quota: 300,
    organization: 'octo', cost_center_name: 'Eng',
    aic_quantity: 1, aic_gross_amount: 0.01, aic_net_amount: 0.01,
    has_aic_quantity: true, has_aic_gross_amount: true,
    ...overrides,
  }
}

async function seedTable(records: TokenUsageRecord[]) {
  const conn = await getDb()
  await createUsageTable(conn)
  const appender = await conn.createAppender('', 'usage')
  for (const r of records) appendRow(appender, r)
  await appender.flush()
  await appender.close()
  return conn
}

describe('queryCostCenters', () => {
  afterEach(async () => { await resetDb() })

  it('groups by cost_center_name and counts distinct users', async () => {
    await seedTable([
      makeRecord({ username: 'mona', cost_center_name: 'Eng', gross_amount: 0.04, discount_amount: 0.01, net_amount: 0.03 }),
      makeRecord({ username: 'hubot', cost_center_name: 'Eng', gross_amount: 0.04, discount_amount: 0.01, net_amount: 0.03 }),
      makeRecord({ username: 'mona', cost_center_name: 'Eng', gross_amount: 0.04, discount_amount: 0.01, net_amount: 0.03 }),
      makeRecord({ username: 'octocat', cost_center_name: 'Ops', gross_amount: 0.08, discount_amount: 0.02, net_amount: 0.06 }),
    ])
    const conn = await getDb()
    const result = await queryCostCenters(conn)

    expect(result.costCenters).toHaveLength(2)
    const eng = result.costCenters.find((c) => c.costCenterName === 'Eng')
    const ops = result.costCenters.find((c) => c.costCenterName === 'Ops')

    expect(eng).toBeDefined()
    expect(eng!.userCount).toBe(2)
    expect(ops).toBeDefined()
    expect(ops!.userCount).toBe(1)
  })

  it('computes netCostPerUser as netAmount / userCount', async () => {
    await seedTable([
      makeRecord({ username: 'mona', cost_center_name: 'Eng', net_amount: 0.06, quantity: 2, gross_amount: 0.08, discount_amount: 0.02 }),
      makeRecord({ username: 'hubot', cost_center_name: 'Eng', net_amount: 0.03, quantity: 1, gross_amount: 0.04, discount_amount: 0.01 }),
    ])
    const conn = await getDb()
    const result = await queryCostCenters(conn)

    const eng = result.costCenters.find((c) => c.costCenterName === 'Eng')
    expect(eng).toBeDefined()
    expect(eng!.userCount).toBe(2)
    expect(eng!.totals.netAmount).toBeCloseTo(0.09)
    expect(eng!.netCostPerUser).toBeCloseTo(0.09 / 2)
  })

  it('returns netCostPerUser = netAmount / userCount for a single user', async () => {
    await seedTable([
      makeRecord({ username: 'solo', cost_center_name: 'Solo', quantity: 5, gross_amount: 0.20, discount_amount: 0.05, net_amount: 0.15 }),
    ])
    const conn = await getDb()
    const result = await queryCostCenters(conn)

    const solo = result.costCenters.find((c) => c.costCenterName === 'Solo')
    expect(solo).toBeDefined()
    expect(solo!.userCount).toBe(1)
    expect(solo!.netCostPerUser).toBeCloseTo(0.15)
  })

  it('populates totalsByModel correctly', async () => {
    await seedTable([
      makeRecord({ username: 'mona', cost_center_name: 'Eng', model: 'GPT-5', quantity: 2, gross_amount: 0.08, discount_amount: 0.02, net_amount: 0.06 }),
      makeRecord({ username: 'mona', cost_center_name: 'Eng', model: 'Claude 3.5', quantity: 1, gross_amount: 0.04, discount_amount: 0.01, net_amount: 0.03 }),
    ])
    const conn = await getDb()
    const result = await queryCostCenters(conn)

    const eng = result.costCenters.find((c) => c.costCenterName === 'Eng')
    expect(eng).toBeDefined()
    expect(Object.keys(eng!.totalsByModel)).toContain('GPT-5')
    expect(Object.keys(eng!.totalsByModel)).toContain('Claude 3.5')
    expect(eng!.totalsByModel['GPT-5'].requests).toBeCloseTo(2)
    expect(eng!.totalsByModel['GPT-5'].grossAmount).toBeCloseTo(0.08)
    expect(eng!.totalsByModel['GPT-5'].discountAmount).toBeCloseTo(0.02)
    expect(eng!.totalsByModel['GPT-5'].netAmount).toBeCloseTo(0.06)
  })

  it('populates totalsByUser correctly (no discountAmount)', async () => {
    await seedTable([
      makeRecord({ username: 'mona', cost_center_name: 'Eng', quantity: 3, gross_amount: 0.12, discount_amount: 0.03, net_amount: 0.09 }),
      makeRecord({ username: 'hubot', cost_center_name: 'Eng', quantity: 1, gross_amount: 0.04, discount_amount: 0.01, net_amount: 0.03 }),
    ])
    const conn = await getDb()
    const result = await queryCostCenters(conn)

    const eng = result.costCenters.find((c) => c.costCenterName === 'Eng')
    expect(eng).toBeDefined()
    expect(Object.keys(eng!.totalsByUser)).toContain('mona')
    expect(Object.keys(eng!.totalsByUser)).toContain('hubot')

    const monaUser = eng!.totalsByUser['mona']
    expect(monaUser.requests).toBeCloseTo(3)
    expect(monaUser.grossAmount).toBeCloseTo(0.12)
    expect(monaUser.netAmount).toBeCloseTo(0.09)
    // CostCenterUserTotals does NOT have discountAmount
    expect('discountAmount' in monaUser).toBe(false)
  })

  it('excludes rows with cost_center_name = null', async () => {
    await seedTable([
      makeRecord({ username: 'mona', cost_center_name: 'Eng' }),
      makeRecord({ username: 'ghost', cost_center_name: null }),
    ])
    const conn = await getDb()
    const result = await queryCostCenters(conn)

    expect(result.costCenters).toHaveLength(1)
    expect(result.costCenters[0].costCenterName).toBe('Eng')
  })

  it('returns cost centers sorted alphabetically', async () => {
    await seedTable([
      makeRecord({ cost_center_name: 'Zebra' }),
      makeRecord({ cost_center_name: 'Alpha' }),
      makeRecord({ cost_center_name: 'Marketing' }),
    ])
    const conn = await getDb()
    const result = await queryCostCenters(conn)

    const names = result.costCenters.map((c) => c.costCenterName)
    expect(names).toEqual(['Alpha', 'Marketing', 'Zebra'])
  })

  it('sums totals (with discountAmount) across multiple rows for same cost center', async () => {
    await seedTable([
      makeRecord({ cost_center_name: 'Eng', quantity: 2, gross_amount: 0.08, discount_amount: 0.02, net_amount: 0.06, aic_quantity: 2, aic_gross_amount: 0.02, aic_net_amount: 0.02 }),
      makeRecord({ cost_center_name: 'Eng', quantity: 3, gross_amount: 0.12, discount_amount: 0.03, net_amount: 0.09, aic_quantity: 3, aic_gross_amount: 0.03, aic_net_amount: 0.03 }),
    ])
    const conn = await getDb()
    const result = await queryCostCenters(conn)

    const eng = result.costCenters.find((c) => c.costCenterName === 'Eng')
    expect(eng!.totals.requests).toBeCloseTo(5)
    expect(eng!.totals.grossAmount).toBeCloseTo(0.20)
    expect(eng!.totals.discountAmount).toBeCloseTo(0.05)
    expect(eng!.totals.netAmount).toBeCloseTo(0.15)
    expect(eng!.totals.aicQuantity).toBeCloseTo(5)
    expect(eng!.totals.aicGrossAmount).toBeCloseTo(0.05)
    expect(eng!.totals.aicNetAmount).toBeCloseTo(0.05)
  })
})
