import { describe, it, expect, afterEach } from 'vitest'
import { getDb, resetDb } from '../duckdb'
import { createUsageTable, appendRow } from '../appender'
import { queryDailyUsage } from './dailyUsage'
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

describe('queryDailyUsage', () => {
  afterEach(async () => { await resetDb() })

  it('groups rows by date and sums metrics correctly', async () => {
    await seedTable([
      makeRecord({ date: '2026-05-01', quantity: 2, gross_amount: 0.08, discount_amount: 0.02, net_amount: 0.06, aic_quantity: 2, aic_gross_amount: 0.02, aic_net_amount: 0.02 }),
      makeRecord({ date: '2026-05-01', quantity: 3, gross_amount: 0.12, discount_amount: 0.03, net_amount: 0.09, aic_quantity: 3, aic_gross_amount: 0.03, aic_net_amount: 0.03 }),
      makeRecord({ date: '2026-05-02', quantity: 1, gross_amount: 0.04, discount_amount: 0.01, net_amount: 0.03, aic_quantity: 1, aic_gross_amount: 0.01, aic_net_amount: 0.01 }),
    ])
    const conn = await getDb()
    const result = await queryDailyUsage(conn)

    expect(result.dailyData).toHaveLength(2)

    const day1 = result.dailyData[0]
    expect(day1.date).toBe('2026-05-01')
    expect(day1.requests).toBeCloseTo(5)
    expect(day1.grossAmount).toBeCloseTo(0.20)
    expect(day1.discountAmount).toBeCloseTo(0.05)
    expect(day1.netAmount).toBeCloseTo(0.15)
    expect(day1.aicQuantity).toBeCloseTo(5)

    const day2 = result.dailyData[1]
    expect(day2.date).toBe('2026-05-02')
    expect(day2.requests).toBeCloseTo(1)
  })

  it('returns dates sorted ascending', async () => {
    await seedTable([
      makeRecord({ date: '2026-05-10' }),
      makeRecord({ date: '2026-05-01' }),
      makeRecord({ date: '2026-05-05' }),
    ])
    const conn = await getDb()
    const result = await queryDailyUsage(conn)

    const dates = result.dailyData.map((d) => d.date)
    expect(dates).toEqual(['2026-05-01', '2026-05-05', '2026-05-10'])
  })

  it('excludes rows with empty or null dates', async () => {
    await seedTable([
      makeRecord({ date: '2026-05-01' }),
      makeRecord({ date: '' }),
    ])
    const conn = await getDb()
    const result = await queryDailyUsage(conn)

    expect(result.dailyData).toHaveLength(1)
    expect(result.dailyData[0].date).toBe('2026-05-01')
  })

  it('returns aicQuantity from ai-credits rows that have has_aic_quantity=true', async () => {
    await seedTable([
      // request row: aicQuantity comes from aic_quantity
      makeRecord({ date: '2026-05-01', unit_type: 'requests', quantity: 1, aic_quantity: 2, has_aic_quantity: true }),
      // ai-credits row with has_aic_quantity: uses aic_quantity
      makeRecord({ date: '2026-05-01', unit_type: 'ai-credits', quantity: 10, aic_quantity: 5, has_aic_quantity: true }),
    ])
    const conn = await getDb()
    const result = await queryDailyUsage(conn)

    expect(result.dailyData).toHaveLength(1)
    // requests row: aicQuantity = aic_quantity = 2
    // ai-credits row with has_aic_quantity: aicQuantity = aic_quantity = 5
    // total = 7
    expect(result.dailyData[0].aicQuantity).toBeCloseTo(7)
  })
})
