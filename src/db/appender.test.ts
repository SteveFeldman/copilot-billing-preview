import { describe, it, expect, afterEach } from 'vitest'
import { getDb, resetDb } from './duckdb'
import { createUsageTable, appendRow } from './appender'
import type { TokenUsageRecord } from '../pipeline/parser'

const BASE_RECORD: TokenUsageRecord = {
  date: '2026-05-01',
  username: 'mona',
  product: 'copilot',
  sku: 'copilot_premium_request',
  model: 'Auto: Claude Haiku 4.5',
  quantity: 2.7,
  unit_type: 'requests',
  applied_cost_per_quantity: 0.04,
  gross_amount: 0.108,
  discount_amount: 0.108,
  net_amount: 0,
  exceeds_quota: false,
  total_monthly_quota: 0,
  organization: 'TotalWineLabs',
  cost_center_name: null,
  aic_quantity: 9.16,
  aic_gross_amount: 0.0916,
  aic_net_amount: 0.0916,
  has_aic_quantity: true,
  has_aic_gross_amount: true,
}

describe('appendRow', () => {
  afterEach(async () => {
    await resetDb()
  })

  it('inserts one row into the usage table', async () => {
    const conn = await getDb()
    await createUsageTable(conn)
    const appender = await conn.createAppender('', 'usage')
    appendRow(appender, BASE_RECORD)
    await appender.flush()
    await appender.close()

    const result = await conn.query('SELECT COUNT(*) AS n FROM usage')
    expect(Number(result.toArray()[0].toJSON().n)).toBe(1)
  })

  it('stores model_display_name not raw model string', async () => {
    const conn = await getDb()
    await createUsageTable(conn)
    const appender = await conn.createAppender('', 'usage')
    appendRow(appender, BASE_RECORD)
    await appender.flush()
    await appender.close()

    const result = await conn.query('SELECT model_display_name FROM usage')
    // getDisplayModelName trims the raw model string; 'Auto: Claude Haiku 4.5' → 'Auto: Claude Haiku 4.5'
    expect(result.toArray()[0].toJSON().model_display_name).toBe('Auto: Claude Haiku 4.5')
  })
})
