import { createAicIncludedCreditsAllocator, type AicIncludedCreditsOverrides } from './aicIncludedCredits'
import {
  parseTokenUsageHeader,
  parseNormalizedTokenUsageRecord,
  parseTokenUsageRecord,
  validateSupportedReportRecord,
  validateHeader,
  type TokenUsageHeader,
} from './parser'
import { streamLines, type StreamProgress } from './streamer'
import { getDb, resetDb } from '../db/duckdb'
import { createUsageTable, appendRow } from '../db/appender'
import { queryQuickStats, queryReportContext } from '../db/queries/quickStats'
import { queryDailyUsage } from '../db/queries/dailyUsage'
import { queryModelUsage } from '../db/queries/modelUsage'
import { queryProductUsage } from '../db/queries/productUsage'
import { queryCostCenters } from '../db/queries/costCenter'
import { queryOrganizations } from '../db/queries/organization'
import { queryUserUsage } from '../db/queries/userUsage'
import type { QuickStatsResult } from './aggregators/quickStatsAggregator'
import type { ReportContextResult } from './aggregators/reportContextAggregator'
import type { DailyUsageResult } from './aggregators/dailyUsageAggregator'
import type { ModelUsageResult } from './aggregators/modelUsageAggregator'
import type { ProductUsageResult } from './aggregators/productUsageAggregator'
import type { CostCenterResult } from './aggregators/costCenterAggregator'
import type { OrganizationResult } from './aggregators/organizationAggregator'
import type { UserUsageResult } from './aggregators/userUsageAggregator'

export interface PipelineDuckDBProgress {
  stage: 'analyzing' | 'ingesting' | 'querying'
  rowsProcessed: number
  bytesProcessed: number
  totalBytes: number
  progressPercent: number
}

export interface PipelineDuckDBOptions {
  includedCreditsOverrides?: AicIncludedCreditsOverrides
  onProgress?: (progress: PipelineDuckDBProgress) => void
}

export interface PipelineDuckDBResult {
  reportRowCount: number
  processedRowCount: number
  quickStats: QuickStatsResult
  reportContext: ReportContextResult
  dailyUsage: DailyUsageResult
  modelUsage: ModelUsageResult
  productUsage: ProductUsageResult
  costCenters: CostCenterResult
  organizations: OrganizationResult
  userUsage: UserUsageResult
}

async function validateFileFormat(file: File): Promise<void> {
  let header: TokenUsageHeader | null = null
  for await (const line of streamLines(file)) {
    const trimmed = line.trimEnd()
    if (!trimmed) continue
    if (!header) {
      header = parseTokenUsageHeader(trimmed)
      validateHeader(header)
      continue
    }
    validateSupportedReportRecord(header, parseTokenUsageRecord(trimmed, header))
    return
  }
}

export async function runPipelineDuckDB(
  file: File,
  options: PipelineDuckDBOptions,
): Promise<PipelineDuckDBResult> {
  const { includedCreditsOverrides = {}, onProgress } = options

  await validateFileFormat(file)

  const aicAllocator = await createAicIncludedCreditsAllocator(file, includedCreditsOverrides, {
    onProgress: (streamProgress: StreamProgress) => {
      onProgress?.({
        stage: 'analyzing',
        rowsProcessed: 0,
        bytesProcessed: streamProgress.bytesProcessed,
        totalBytes: streamProgress.totalBytes,
        progressPercent: Math.round((streamProgress.bytesProcessed / streamProgress.totalBytes) * 40),
      })
    },
  })

  await resetDb()
  const conn = await getDb()
  await createUsageTable(conn)
  const appender = await conn.createAppender('', 'usage')

  let header: TokenUsageHeader | null = null
  let reportRowCount = 0
  let processedRowCount = 0

  for await (const line of streamLines(file, {
    onProgress: (streamProgress: StreamProgress) => {
      const ratio = streamProgress.totalBytes > 0
        ? streamProgress.bytesProcessed / streamProgress.totalBytes
        : 1
      onProgress?.({
        stage: 'ingesting',
        rowsProcessed: processedRowCount,
        bytesProcessed: streamProgress.bytesProcessed,
        totalBytes: streamProgress.totalBytes,
        progressPercent: 40 + Math.round(ratio * 50),
      })
    },
  })) {
    const trimmed = line.trimEnd()
    if (!trimmed) continue

    if (!header) {
      header = parseTokenUsageHeader(trimmed)
      continue
    }

    const normalized = parseNormalizedTokenUsageRecord(trimmed, header)
    reportRowCount += 1
    if (!normalized) continue

    const record = aicAllocator.apply(normalized)
    appendRow(appender, record)
    processedRowCount += 1
  }

  await appender.flush()
  await appender.close()

  onProgress?.({
    stage: 'querying',
    rowsProcessed: processedRowCount,
    bytesProcessed: file.size,
    totalBytes: file.size,
    progressPercent: 90,
  })

  const [quickStats, reportContext, dailyUsage, modelUsage, productUsage, costCenters, organizations, userUsage] =
    await Promise.all([
      queryQuickStats(conn),
      queryReportContext(conn),
      queryDailyUsage(conn),
      queryModelUsage(conn),
      queryProductUsage(conn),
      queryCostCenters(conn),
      queryOrganizations(conn),
      queryUserUsage(conn),
    ])

  onProgress?.({
    stage: 'querying',
    rowsProcessed: processedRowCount,
    bytesProcessed: file.size,
    totalBytes: file.size,
    progressPercent: 100,
  })

  return {
    reportRowCount,
    processedRowCount,
    quickStats,
    reportContext,
    dailyUsage,
    modelUsage,
    productUsage,
    costCenters,
    organizations,
    userUsage,
  }
}
