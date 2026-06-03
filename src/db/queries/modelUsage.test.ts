import { describe, it, expect, afterEach } from 'vitest'
import { getDb, resetDb } from '../duckdb'
import { createUsageTable, appendRow } from '../appender'
import { queryModelUsage } from './modelUsage'
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

describe('queryModelUsage', () => {
  afterEach(async () => { await resetDb() })

  it('groups by model_display_name and creates byModel entries', async () => {
    await seedTable([
      makeRecord({ model: 'GPT-5', date: '2026-05-01', quantity: 2, gross_amount: 0.08, discount_amount: 0.02, net_amount: 0.06 }),
      makeRecord({ model: 'Claude 3.5 Sonnet', date: '2026-05-01', quantity: 1, gross_amount: 0.04, discount_amount: 0.01, net_amount: 0.03 }),
    ])
    const conn = await getDb()
    const result = await queryModelUsage(conn)

    expect(result.models).toContain('GPT-5')
    expect(result.models).toContain('Claude 3.5 Sonnet')
    expect(result.byModel['GPT-5']).toHaveLength(1)
    expect(result.byModel['Claude 3.5 Sonnet']).toHaveLength(1)
  })

  it('sums totals across multiple dates for the same model', async () => {
    await seedTable([
      makeRecord({ model: 'GPT-5', date: '2026-05-01', quantity: 2, gross_amount: 0.08, discount_amount: 0.02, net_amount: 0.06, aic_quantity: 2, aic_gross_amount: 0.02, aic_net_amount: 0.02 }),
      makeRecord({ model: 'GPT-5', date: '2026-05-02', quantity: 3, gross_amount: 0.12, discount_amount: 0.03, net_amount: 0.09, aic_quantity: 3, aic_gross_amount: 0.03, aic_net_amount: 0.03 }),
    ])
    const conn = await getDb()
    const result = await queryModelUsage(conn)

    expect(result.models).toContain('GPT-5')
    expect(result.byModel['GPT-5']).toHaveLength(2)

    const totals = result.totalsByModel['GPT-5']
    expect(totals.requests).toBeCloseTo(5)
    expect(totals.grossAmount).toBeCloseTo(0.20)
    expect(totals.discountAmount).toBeCloseTo(0.05)
    expect(totals.netAmount).toBeCloseTo(0.15)
    expect(totals.aicQuantity).toBeCloseTo(5)
  })

  it('returns per-day entries in ascending date order for each model', async () => {
    await seedTable([
      makeRecord({ model: 'GPT-5', date: '2026-05-10' }),
      makeRecord({ model: 'GPT-5', date: '2026-05-01' }),
      makeRecord({ model: 'GPT-5', date: '2026-05-05' }),
    ])
    const conn = await getDb()
    const result = await queryModelUsage(conn)

    const dates = result.byModel['GPT-5'].map((d) => d.date)
    expect(dates).toEqual(['2026-05-01', '2026-05-05', '2026-05-10'])
  })

  it('correctly maps per-day metrics for byModel entries', async () => {
    await seedTable([
      makeRecord({ model: 'GPT-5', date: '2026-05-01', quantity: 4, gross_amount: 0.16, discount_amount: 0.04, net_amount: 0.12, aic_quantity: 4, aic_gross_amount: 0.04, aic_net_amount: 0.04 }),
    ])
    const conn = await getDb()
    const result = await queryModelUsage(conn)

    const day = result.byModel['GPT-5'][0]
    expect(day.date).toBe('2026-05-01')
    expect(day.requests).toBeCloseTo(4)
    expect(day.grossAmount).toBeCloseTo(0.16)
    expect(day.discountAmount).toBeCloseTo(0.04)
    expect(day.netAmount).toBeCloseTo(0.12)
    expect(day.aicQuantity).toBeCloseTo(4)
  })

  it('returns models list containing all unique models', async () => {
    await seedTable([
      makeRecord({ model: 'ModelA' }),
      makeRecord({ model: 'ModelB' }),
      makeRecord({ model: 'ModelA' }),
    ])
    const conn = await getDb()
    const result = await queryModelUsage(conn)

    expect(result.models).toHaveLength(2)
    expect(result.models).toContain('ModelA')
    expect(result.models).toContain('ModelB')
  })
})
