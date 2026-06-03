import { describe, it, expect, afterEach } from 'vitest'
import { getDb, resetDb } from '../duckdb'
import { createUsageTable, appendRow } from '../appender'
import { queryUserUsage } from './userUsage'
import type { TokenUsageRecord } from '../../pipeline/parser'

function makeRecord(overrides: Partial<TokenUsageRecord> = {}): TokenUsageRecord {
  return {
    date: '2026-05-01',
    username: 'mona',
    product: 'copilot',
    sku: 'copilot_premium_request',
    model: 'GPT-5',
    quantity: 1,
    unit_type: 'requests',
    applied_cost_per_quantity: 0.04,
    gross_amount: 0.04,
    discount_amount: 0.01,
    net_amount: 0.03,
    exceeds_quota: false,
    total_monthly_quota: 300,
    organization: 'octo',
    cost_center_name: 'Eng',
    aic_quantity: 1,
    aic_gross_amount: 0.01,
    aic_net_amount: 0.01,
    has_aic_quantity: true,
    has_aic_gross_amount: true,
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

describe('queryUserUsage', () => {
  afterEach(async () => { await resetDb() })

  it('returns one entry per user with correct totals', async () => {
    const conn = await seedTable([
      makeRecord({ username: 'mona', quantity: 2, gross_amount: 0.08, discount_amount: 0.02, net_amount: 0.06, aic_quantity: 2, aic_gross_amount: 0.02, aic_net_amount: 0.02 }),
      makeRecord({ username: 'mona', quantity: 3, gross_amount: 0.12, discount_amount: 0.03, net_amount: 0.09, aic_quantity: 3, aic_gross_amount: 0.03, aic_net_amount: 0.03 }),
      makeRecord({ username: 'hubot', quantity: 5, gross_amount: 0.20, discount_amount: 0.05, net_amount: 0.15, aic_quantity: 5, aic_gross_amount: 0.05, aic_net_amount: 0.05 }),
    ])
    const result = await queryUserUsage(conn)

    expect(result.users).toHaveLength(2)

    const mona = result.users.find((u) => u.username === 'mona')
    expect(mona).toBeDefined()
    expect(mona!.totals.requests).toBeCloseTo(5)
    expect(mona!.totals.grossAmount).toBeCloseTo(0.20)
    expect(mona!.totals.discountAmount).toBeCloseTo(0.05)
    expect(mona!.totals.netAmount).toBeCloseTo(0.15)
    expect(mona!.totals.aicQuantity).toBeCloseTo(5)
    expect(mona!.totals.aicGrossAmount).toBeCloseTo(0.05)
    expect(mona!.totals.aicNetAmount).toBeCloseTo(0.05)

    const hubot = result.users.find((u) => u.username === 'hubot')
    expect(hubot).toBeDefined()
    expect(hubot!.totals.requests).toBeCloseTo(5)
    expect(hubot!.totals.grossAmount).toBeCloseTo(0.20)
  })

  it('totals.distinctModels reflects the number of distinct models per user', async () => {
    const conn = await seedTable([
      makeRecord({ username: 'mona', model: 'GPT-5' }),
      makeRecord({ username: 'mona', model: 'Claude 3.5' }),
      makeRecord({ username: 'mona', model: 'GPT-5' }),
      makeRecord({ username: 'hubot', model: 'GPT-5' }),
    ])
    const result = await queryUserUsage(conn)

    const mona = result.users.find((u) => u.username === 'mona')
    expect(mona!.totals.distinctModels).toBe(2)

    const hubot = result.users.find((u) => u.username === 'hubot')
    expect(hubot!.totals.distinctModels).toBe(1)
  })

  it('daily map has entries keyed by date with correct metrics', async () => {
    const conn = await seedTable([
      makeRecord({ username: 'mona', date: '2026-05-01', quantity: 2, gross_amount: 0.08, discount_amount: 0.02, net_amount: 0.06 }),
      makeRecord({ username: 'mona', date: '2026-05-02', quantity: 3, gross_amount: 0.12, discount_amount: 0.03, net_amount: 0.09 }),
    ])
    const result = await queryUserUsage(conn)

    const mona = result.users.find((u) => u.username === 'mona')!
    expect(Object.keys(mona.daily)).toContain('2026-05-01')
    expect(Object.keys(mona.daily)).toContain('2026-05-02')

    const day1 = mona.daily['2026-05-01']
    expect(day1.date).toBe('2026-05-01')
    expect(day1.requests).toBeCloseTo(2)
    expect(day1.grossAmount).toBeCloseTo(0.08)
    expect(day1.discountAmount).toBeCloseTo(0.02)
    expect(day1.netAmount).toBeCloseTo(0.06)

    const day2 = mona.daily['2026-05-02']
    expect(day2.requests).toBeCloseTo(3)
  })

  it('daily[date].models is populated with per-model data', async () => {
    const conn = await seedTable([
      makeRecord({ username: 'mona', date: '2026-05-01', model: 'GPT-5', quantity: 2, gross_amount: 0.08, discount_amount: 0.02, net_amount: 0.06 }),
      makeRecord({ username: 'mona', date: '2026-05-01', model: 'Claude 3.5', quantity: 1, gross_amount: 0.04, discount_amount: 0.01, net_amount: 0.03 }),
      makeRecord({ username: 'mona', date: '2026-05-02', model: 'GPT-5', quantity: 3, gross_amount: 0.12, discount_amount: 0.03, net_amount: 0.09 }),
    ])
    const result = await queryUserUsage(conn)

    const mona = result.users.find((u) => u.username === 'mona')!
    const day1 = mona.daily['2026-05-01']

    // models must be populated — this is the key behavior used by UserDetailsView.tsx
    expect(Object.keys(day1.models)).toContain('GPT-5')
    expect(Object.keys(day1.models)).toContain('Claude 3.5')
    expect(day1.models['GPT-5'].requests).toBeCloseTo(2)
    expect(day1.models['GPT-5'].grossAmount).toBeCloseTo(0.08)
    expect(day1.models['GPT-5'].discountAmount).toBeCloseTo(0.02)
    expect(day1.models['GPT-5'].netAmount).toBeCloseTo(0.06)
    expect(day1.models['Claude 3.5'].requests).toBeCloseTo(1)

    const day2 = mona.daily['2026-05-02']
    expect(Object.keys(day2.models)).toContain('GPT-5')
    expect(day2.models['GPT-5'].requests).toBeCloseTo(3)
  })

  it('products map has entries keyed by friendly product name with model breakdown', async () => {
    const conn = await seedTable([
      makeRecord({ username: 'mona', product: 'copilot', sku: 'copilot_premium_request', model: 'GPT-5', quantity: 2, gross_amount: 0.08, discount_amount: 0.02, net_amount: 0.06 }),
      makeRecord({ username: 'mona', product: 'copilot', sku: 'copilot_premium_request', model: 'Claude 3.5', quantity: 1, gross_amount: 0.04, discount_amount: 0.01, net_amount: 0.03 }),
    ])
    const result = await queryUserUsage(conn)

    const mona = result.users.find((u) => u.username === 'mona')!
    expect(Object.keys(mona.products)).toContain('Copilot')

    const copilot = mona.products['Copilot']
    expect(copilot.totals.requests).toBeCloseTo(3)
    expect(copilot.totals.grossAmount).toBeCloseTo(0.12)
    expect(copilot.totals.discountAmount).toBeCloseTo(0.03)
    expect(copilot.totals.netAmount).toBeCloseTo(0.09)
    expect(Object.keys(copilot.models)).toContain('GPT-5')
    expect(Object.keys(copilot.models)).toContain('Claude 3.5')
    expect(copilot.models['GPT-5'].requests).toBeCloseTo(2)
    expect(copilot.models['Claude 3.5'].requests).toBeCloseTo(1)
  })

  it('classifies Spark product correctly', async () => {
    const conn = await seedTable([
      makeRecord({ username: 'mona', product: 'spark', sku: 'some_sku', model: 'GPT-5', quantity: 1, gross_amount: 0.10, discount_amount: 0.01, net_amount: 0.09 }),
    ])
    const result = await queryUserUsage(conn)

    const mona = result.users.find((u) => u.username === 'mona')!
    expect(Object.keys(mona.products)).toContain('Spark')
    expect(mona.products['Spark'].totals.requests).toBeCloseTo(1)
  })

  it('classifies coding agent model as Copilot Cloud Agent', async () => {
    const conn = await seedTable([
      makeRecord({ username: 'mona', product: 'copilot', sku: 'copilot_premium_request', model: 'GitHub Copilot Coding Agent', quantity: 1, gross_amount: 0.50, discount_amount: 0.05, net_amount: 0.45 }),
    ])
    const result = await queryUserUsage(conn)

    const mona = result.users.find((u) => u.username === 'mona')!
    expect(Object.keys(mona.products)).toContain('Copilot Cloud Agent')
    expect(mona.products['Copilot Cloud Agent'].totals.requests).toBeCloseTo(1)
  })

  it('spendSegment field is present and is a valid segment ID', async () => {
    const validSegments = new Set(['power', 'heavy', 'typical', 'light', 'near-zero'])

    const conn = await seedTable([
      makeRecord({ username: 'mona', aic_gross_amount: 10.00 }),
      makeRecord({ username: 'hubot', aic_gross_amount: 0.00 }),
    ])
    const result = await queryUserUsage(conn)

    for (const user of result.users) {
      expect(validSegments.has(user.spendSegment)).toBe(true)
    }

    const hubot = result.users.find((u) => u.username === 'hubot')
    expect(hubot!.spendSegment).toBe('near-zero')
  })

  it('organizations and costCenters arrays are populated', async () => {
    const conn = await seedTable([
      makeRecord({ username: 'mona', organization: 'octo', cost_center_name: 'Eng' }),
      makeRecord({ username: 'mona', organization: 'labs', cost_center_name: 'Research' }),
      makeRecord({ username: 'mona', organization: 'octo', cost_center_name: 'Eng' }),
    ])
    const result = await queryUserUsage(conn)

    const mona = result.users.find((u) => u.username === 'mona')!
    expect(mona.organizations).toContain('octo')
    expect(mona.organizations).toContain('labs')
    expect(mona.costCenters).toContain('Eng')
    expect(mona.costCenters).toContain('Research')
    // No duplicates
    expect(mona.organizations.filter((o) => o === 'octo')).toHaveLength(1)
    expect(mona.costCenters.filter((c) => c === 'Eng')).toHaveLength(1)
  })

  it('excludes rows with empty or null username', async () => {
    const conn = await seedTable([
      makeRecord({ username: 'mona' }),
      makeRecord({ username: '' }),
    ])
    const result = await queryUserUsage(conn)

    expect(result.users).toHaveLength(1)
    expect(result.users[0].username).toBe('mona')
  })

  it('totalMonthlyQuota is the max seen for a user', async () => {
    const conn = await seedTable([
      makeRecord({ username: 'mona', total_monthly_quota: 300 }),
      makeRecord({ username: 'mona', total_monthly_quota: 500 }),
    ])
    const result = await queryUserUsage(conn)

    const mona = result.users.find((u) => u.username === 'mona')!
    expect(mona.totalMonthlyQuota).toBe(500)
  })
})
