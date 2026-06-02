import { describe, it, expect, afterEach } from 'vitest'
import { getDb, resetDb } from './duckdb'

describe('getDb', () => {
  afterEach(async () => {
    await resetDb()
  })

  it('returns an open DuckDB connection', async () => {
    const conn = await getDb()
    const result = await conn.query('SELECT 42 AS answer')
    expect(result.toArray()[0].toJSON().answer).toBe(42)
  })

  it('returns the same connection on repeated calls', async () => {
    const a = await getDb()
    const b = await getDb()
    expect(a).toBe(b)
  })
})
