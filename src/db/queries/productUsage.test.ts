import { describe, it, expect, afterEach } from 'vitest'
import { getDb, resetDb } from '../duckdb'
import { createUsageTable, appendRow } from '../appender'
import { queryProductUsage } from './productUsage'
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

describe('queryProductUsage', () => {
  afterEach(async () => { await resetDb() })

  it('classifies rows with product=spark as Spark', async () => {
    await seedTable([
      makeRecord({ product: 'spark', sku: 'some_sku', model: 'SomeModel', quantity: 5, gross_amount: 0.20, net_amount: 0.15, aic_quantity: 5, aic_net_amount: 0.05 }),
    ])
    const conn = await getDb()
    const result = await queryProductUsage(conn)

    const productNames = result.products.map((p) => p.product)
    expect(productNames).toContain('Spark')
    expect(productNames).not.toContain('Copilot')
  })

  it('classifies rows with sku=spark_premium_request as Spark', async () => {
    await seedTable([
      makeRecord({ product: 'copilot', sku: 'spark_premium_request', model: 'SomeModel', quantity: 3, gross_amount: 0.12, net_amount: 0.09, aic_quantity: 3, aic_net_amount: 0.03 }),
    ])
    const conn = await getDb()
    const result = await queryProductUsage(conn)

    const productNames = result.products.map((p) => p.product)
    expect(productNames).toContain('Spark')
    expect(productNames).not.toContain('Copilot')
  })

  it('classifies rows with model containing "coding agent" as Copilot Cloud Agent', async () => {
    await seedTable([
      makeRecord({ product: 'copilot', sku: 'copilot_premium_request', model: 'coding agent v2', quantity: 2, gross_amount: 0.08, net_amount: 0.06, aic_quantity: 2, aic_net_amount: 0.02 }),
    ])
    const conn = await getDb()
    const result = await queryProductUsage(conn)

    const productNames = result.products.map((p) => p.product)
    expect(productNames).toContain('Copilot Cloud Agent')
    expect(productNames).not.toContain('Copilot')
  })

  it('classifies rows with model containing "padawan" as Copilot Cloud Agent', async () => {
    await seedTable([
      makeRecord({ product: 'copilot', sku: 'copilot_premium_request', model: 'padawan-turbo', quantity: 1, gross_amount: 0.04, net_amount: 0.03, aic_quantity: 1, aic_net_amount: 0.01 }),
    ])
    const conn = await getDb()
    const result = await queryProductUsage(conn)

    const productNames = result.products.map((p) => p.product)
    expect(productNames).toContain('Copilot Cloud Agent')
  })

  it('classifies other rows as Copilot', async () => {
    await seedTable([
      makeRecord({ product: 'copilot', sku: 'copilot_premium_request', model: 'GPT-5', quantity: 1, gross_amount: 0.04, net_amount: 0.03, aic_quantity: 1, aic_net_amount: 0.01 }),
    ])
    const conn = await getDb()
    const result = await queryProductUsage(conn)

    const productNames = result.products.map((p) => p.product)
    expect(productNames).toContain('Copilot')
    expect(productNames).not.toContain('Spark')
    expect(productNames).not.toContain('Copilot Cloud Agent')
  })

  it('sums totals correctly per product', async () => {
    await seedTable([
      makeRecord({ product: 'copilot', sku: 'copilot_premium_request', model: 'GPT-5', quantity: 2, gross_amount: 0.08, net_amount: 0.06, aic_quantity: 2, aic_gross_amount: 0.02, aic_net_amount: 0.02 }),
      makeRecord({ product: 'copilot', sku: 'copilot_premium_request', model: 'GPT-5', quantity: 3, gross_amount: 0.12, net_amount: 0.09, aic_quantity: 3, aic_gross_amount: 0.03, aic_net_amount: 0.03 }),
    ])
    const conn = await getDb()
    const result = await queryProductUsage(conn)

    const copilot = result.products.find((p) => p.product === 'Copilot')
    expect(copilot).toBeDefined()
    expect(copilot!.totals.requests).toBeCloseTo(5)
    expect(copilot!.totals.grossAmount).toBeCloseTo(0.20)
    expect(copilot!.totals.netAmount).toBeCloseTo(0.15)
    expect(copilot!.totals.aicQuantity).toBeCloseTo(5)
  })

  it('builds model breakdown inside each product', async () => {
    await seedTable([
      makeRecord({ product: 'copilot', sku: 'copilot_premium_request', model: 'GPT-5', quantity: 2, gross_amount: 0.08, net_amount: 0.06, aic_quantity: 2, aic_net_amount: 0.02 }),
      makeRecord({ product: 'copilot', sku: 'copilot_premium_request', model: 'Claude 3.5 Sonnet', quantity: 1, gross_amount: 0.04, net_amount: 0.03, aic_quantity: 1, aic_net_amount: 0.01 }),
    ])
    const conn = await getDb()
    const result = await queryProductUsage(conn)

    const copilot = result.products.find((p) => p.product === 'Copilot')
    expect(copilot).toBeDefined()
    expect(Object.keys(copilot!.models)).toContain('GPT-5')
    expect(Object.keys(copilot!.models)).toContain('Claude 3.5 Sonnet')

    expect(copilot!.models['GPT-5'].requests).toBeCloseTo(2)
    expect(copilot!.models['Claude 3.5 Sonnet'].requests).toBeCloseTo(1)
  })

  it('produces separate product entries for Spark and Copilot', async () => {
    await seedTable([
      makeRecord({ product: 'spark', sku: 'some_sku', model: 'SomeModel', quantity: 5, gross_amount: 0.20, net_amount: 0.15, aic_quantity: 5, aic_net_amount: 0.05 }),
      makeRecord({ product: 'copilot', sku: 'copilot_premium_request', model: 'GPT-5', quantity: 2, gross_amount: 0.08, net_amount: 0.06, aic_quantity: 2, aic_net_amount: 0.02 }),
    ])
    const conn = await getDb()
    const result = await queryProductUsage(conn)

    expect(result.products).toHaveLength(2)
    const productNames = result.products.map((p) => p.product)
    expect(productNames).toContain('Spark')
    expect(productNames).toContain('Copilot')
  })

  it('ProductUsageTotals does not include discountAmount field', async () => {
    await seedTable([
      makeRecord({ product: 'copilot', sku: 'copilot_premium_request', model: 'GPT-5' }),
    ])
    const conn = await getDb()
    const result = await queryProductUsage(conn)

    const copilot = result.products.find((p) => p.product === 'Copilot')
    expect(copilot).toBeDefined()
    expect('discountAmount' in copilot!.totals).toBe(false)
  })
})
