import { describe, it, expect, afterEach } from 'vitest'
import { runPipelineDuckDB } from './runPipelineDuckDB'
import { resetDb } from '../db/duckdb'

const HEADER = [
  'date', 'username', 'product', 'sku', 'model', 'quantity', 'unit_type',
  'applied_cost_per_quantity', 'gross_amount', 'discount_amount', 'net_amount',
  'exceeds_quota', 'total_monthly_quota', 'organization', 'cost_center_name',
  'aic_quantity', 'aic_gross_amount',
].join(',')

function createCsv(rows: string[][]): File {
  const body = [HEADER, ...rows.map((r) => r.join(','))].join('\n')
  return new File([body], 'usage.csv', { type: 'text/csv' })
}

describe('runPipelineDuckDB', () => {
  afterEach(async () => { await resetDb() })

  it('returns correct row counts', async () => {
    const file = createCsv([
      ['2026-05-01', 'mona',  'copilot', 'copilot_premium_request', 'GPT-5', '10', 'requests', '0.04', '0.40', '0', '0.40', 'False', '300', 'octo', '', '5', '0.05'],
      ['2026-05-01', 'hubot', 'copilot', 'copilot_premium_request', 'GPT-5', '5',  'requests', '0.04', '0.20', '0', '0.20', 'False', '300', 'octo', '', '2', '0.02'],
    ])
    const result = await runPipelineDuckDB(file, {})
    expect(result.reportRowCount).toBe(2)
    expect(result.processedRowCount).toBe(2)
  })

  it('produces daily usage data from ingested rows', async () => {
    const file = createCsv([
      ['2026-05-01', 'mona', 'copilot', 'copilot_premium_request', 'GPT-5', '10', 'requests', '0.04', '0.40', '0', '0.40', 'False', '300', 'octo', '', '5', '0.05'],
      ['2026-05-02', 'mona', 'copilot', 'copilot_premium_request', 'GPT-5', '3',  'requests', '0.04', '0.12', '0', '0.12', 'False', '300', 'octo', '', '2', '0.02'],
    ])
    const result = await runPipelineDuckDB(file, {})
    expect(result.dailyUsage.dailyData).toHaveLength(2)
    expect(result.dailyUsage.dailyData[0].date).toBe('2026-05-01')
    expect(result.dailyUsage.dailyData[0].requests).toBeCloseTo(10)
  })

  it('rejects unsupported report format', async () => {
    const NATIVE_HEADER = [
      'date', 'username', 'product', 'sku', 'model', 'quantity', 'unit_type',
      'applied_cost_per_quantity', 'gross_amount', 'discount_amount', 'net_amount',
      'total_monthly_quota', 'organization', 'cost_center_name',
      'aic_quantity', 'aic_gross_amount',
    ].join(',')
    const body = [
      NATIVE_HEADER,
      ['5/29/26', 'mona', 'copilot', 'copilot_ai_credit', 'GPT-5', '96', 'ai-credits', '0.01', '0.96', '0', '0.96', '3900', 'octo', '', '96', '0.96'].join(','),
    ].join('\n')
    const file = new File([body], 'usage.csv', { type: 'text/csv' })

    await expect(runPipelineDuckDB(file, {})).rejects.toThrow(
      'currently supports PRU vs usage-based billing reports',
    )
  })
})
