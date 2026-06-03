import { describe, it, expect, afterEach } from 'vitest'
import { getDb, resetDb } from '../duckdb'
import { createUsageTable, appendRow } from '../appender'
import { queryQuickStats, queryReportContext } from './quickStats'
import type { TokenUsageRecord } from '../../pipeline/parser'

function makeRecord(overrides: Partial<TokenUsageRecord> = {}): TokenUsageRecord {
  return {
    date: '2026-05-01', username: 'mona', product: 'copilot',
    sku: 'copilot_premium_request', model: 'GPT-5', quantity: 1,
    unit_type: 'requests', applied_cost_per_quantity: 0.04,
    gross_amount: 0.04, discount_amount: 0, net_amount: 0.04,
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

describe('queryQuickStats', () => {
  afterEach(async () => { await resetDb() })

  it('counts distinct users, orgs, cost centers, and rows', async () => {
    await seedTable([
      makeRecord({ username: 'mona', organization: 'octo', cost_center_name: 'Eng' }),
      makeRecord({ username: 'hubot', organization: 'octo', cost_center_name: 'Ops' }),
      makeRecord({ username: 'mona', organization: 'github', cost_center_name: null }),
    ])
    const conn = await getDb()
    const result = await queryQuickStats(conn)
    expect(result).toEqual({ lineCount: 3, userCount: 2, orgCount: 2, costCenterCount: 2 })
  })
})

describe('queryReportContext', () => {
  afterEach(async () => { await resetDb() })

  it('returns start and end dates', async () => {
    await seedTable([
      makeRecord({ date: '2026-05-03' }),
      makeRecord({ date: '2026-05-01' }),
      makeRecord({ date: '2026-05-10' }),
    ])
    const conn = await getDb()
    const result = await queryReportContext(conn)
    expect(result.startDate).toBe('2026-05-01')
    expect(result.endDate).toBe('2026-05-10')
    expect(result.products).toContain('copilot')
    expect(result.skus).toContain('copilot_premium_request')
    expect(result.unitTypes).toContain('requests')
  })
})
