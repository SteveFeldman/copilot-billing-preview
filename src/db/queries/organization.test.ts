import { describe, it, expect, afterEach } from 'vitest'
import { getDb, resetDb } from '../duckdb'
import { createUsageTable, appendRow } from '../appender'
import { queryOrganizationUsage } from './organization'
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

describe('queryOrganizationUsage', () => {
  afterEach(async () => { await resetDb() })

  it('groups by organization and counts distinct users', async () => {
    await seedTable([
      makeRecord({ username: 'mona', organization: 'octo' }),
      makeRecord({ username: 'hubot', organization: 'octo' }),
      makeRecord({ username: 'mona', organization: 'octo' }),
      makeRecord({ username: 'octocat', organization: 'github' }),
    ])
    const conn = await getDb()
    const result = await queryOrganizationUsage(conn)

    expect(result.organizations).toHaveLength(2)
    const octo = result.organizations.find((o) => o.organization === 'octo')
    const github = result.organizations.find((o) => o.organization === 'github')

    expect(octo).toBeDefined()
    expect(octo!.userCount).toBe(2)
    expect(github).toBeDefined()
    expect(github!.userCount).toBe(1)
  })

  it('sums totals (with discountAmount) across multiple rows', async () => {
    await seedTable([
      makeRecord({ organization: 'octo', quantity: 2, gross_amount: 0.08, discount_amount: 0.02, net_amount: 0.06, aic_quantity: 2, aic_gross_amount: 0.02, aic_net_amount: 0.02 }),
      makeRecord({ organization: 'octo', quantity: 3, gross_amount: 0.12, discount_amount: 0.03, net_amount: 0.09, aic_quantity: 3, aic_gross_amount: 0.03, aic_net_amount: 0.03 }),
    ])
    const conn = await getDb()
    const result = await queryOrganizationUsage(conn)

    const octo = result.organizations.find((o) => o.organization === 'octo')
    expect(octo!.totals.requests).toBeCloseTo(5)
    expect(octo!.totals.grossAmount).toBeCloseTo(0.20)
    expect(octo!.totals.discountAmount).toBeCloseTo(0.05)
    expect(octo!.totals.netAmount).toBeCloseTo(0.15)
    expect(octo!.totals.aicQuantity).toBeCloseTo(5)
    expect(octo!.totals.aicGrossAmount).toBeCloseTo(0.05)
    expect(octo!.totals.aicNetAmount).toBeCloseTo(0.05)
  })

  it('populates totalsByModel correctly', async () => {
    await seedTable([
      makeRecord({ username: 'mona', organization: 'octo', model: 'GPT-5', quantity: 2, gross_amount: 0.08, discount_amount: 0.02, net_amount: 0.06 }),
      makeRecord({ username: 'mona', organization: 'octo', model: 'Claude 3.5', quantity: 1, gross_amount: 0.04, discount_amount: 0.01, net_amount: 0.03 }),
    ])
    const conn = await getDb()
    const result = await queryOrganizationUsage(conn)

    const octo = result.organizations.find((o) => o.organization === 'octo')
    expect(octo).toBeDefined()
    expect(Object.keys(octo!.totalsByModel)).toContain('GPT-5')
    expect(Object.keys(octo!.totalsByModel)).toContain('Claude 3.5')
    expect(octo!.totalsByModel['GPT-5'].requests).toBeCloseTo(2)
    expect(octo!.totalsByModel['GPT-5'].grossAmount).toBeCloseTo(0.08)
    expect(octo!.totalsByModel['GPT-5'].discountAmount).toBeCloseTo(0.02)
    expect(octo!.totalsByModel['GPT-5'].netAmount).toBeCloseTo(0.06)
  })

  it('populates totalsByUser correctly (no discountAmount)', async () => {
    await seedTable([
      makeRecord({ username: 'mona', organization: 'octo', quantity: 3, gross_amount: 0.12, discount_amount: 0.03, net_amount: 0.09 }),
      makeRecord({ username: 'hubot', organization: 'octo', quantity: 1, gross_amount: 0.04, discount_amount: 0.01, net_amount: 0.03 }),
    ])
    const conn = await getDb()
    const result = await queryOrganizationUsage(conn)

    const octo = result.organizations.find((o) => o.organization === 'octo')
    expect(octo).toBeDefined()
    expect(Object.keys(octo!.totalsByUser)).toContain('mona')
    expect(Object.keys(octo!.totalsByUser)).toContain('hubot')

    const monaUser = octo!.totalsByUser['mona']
    expect(monaUser.requests).toBeCloseTo(3)
    expect(monaUser.grossAmount).toBeCloseTo(0.12)
    expect(monaUser.netAmount).toBeCloseTo(0.09)
    // OrgUserTotals does NOT have discountAmount
    expect('discountAmount' in monaUser).toBe(false)
  })

  it('returns organizations sorted alphabetically', async () => {
    await seedTable([
      makeRecord({ organization: 'Zebra' }),
      makeRecord({ organization: 'Alpha' }),
      makeRecord({ organization: 'Mozilla' }),
    ])
    const conn = await getDb()
    const result = await queryOrganizationUsage(conn)

    const names = result.organizations.map((o) => o.organization)
    expect(names).toEqual(['Alpha', 'Mozilla', 'Zebra'])
  })

  it('does not have a netCostPerUser field on OrganizationUsage', async () => {
    await seedTable([makeRecord({ organization: 'octo' })])
    const conn = await getDb()
    const result = await queryOrganizationUsage(conn)

    expect(result.organizations).toHaveLength(1)
    expect('netCostPerUser' in result.organizations[0]).toBe(false)
  })
})
