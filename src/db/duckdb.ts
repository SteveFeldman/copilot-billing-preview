import * as duckdb from '@duckdb/duckdb-wasm'
import { createRequire } from 'node:module'

function getBrowserBundles(): duckdb.DuckDBBundles {
  const duckdbMvpWasm = new URL(
    '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm',
    import.meta.url,
  ).href
  const duckdbEhWasm = new URL(
    '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm',
    import.meta.url,
  ).href
  const mvpWorker = new URL(
    '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js',
    import.meta.url,
  ).href
  const ehWorker = new URL(
    '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js',
    import.meta.url,
  ).href

  return {
    mvp: { mainModule: duckdbMvpWasm, mainWorker: mvpWorker },
    eh: { mainModule: duckdbEhWasm, mainWorker: ehWorker },
  }
}

function getNodeBundle(): { mainModule: string; mainWorker: string } {
  const require = createRequire(import.meta.url)
  return {
    // The EH wasm file (same one used by both browser and node EH bundles)
    mainModule: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm'),
    // The node EH worker CJS (loaded via the node bundle's internal shim)
    mainWorker: require.resolve(
      '@duckdb/duckdb-wasm/dist/duckdb-node-eh.worker.cjs',
    ),
  }
}

/**
 * Wraps a node:worker_threads Worker with a DOM-compatible interface.
 *
 * AsyncDuckDB expects a Worker with addEventListener/postMessage/terminate.
 * The node:worker_threads Worker uses EventEmitter-style .on() instead.
 *
 * The worker script must be duckdb-node.cjs (not the bare .cjs worker file)
 * because duckdb-node.cjs contains the parentPort↔globalThis bridge that
 * the EH worker expects. We pass workerData.mod pointing to the actual
 * worker implementation file — this is the same pattern the duckdb-node
 * bundle uses internally.
 */
async function createNodeWorkerAdapter(workerCjsPath: string): Promise<Worker> {
  const { Worker: NodeWorker } = await import('node:worker_threads')
  const require = createRequire(import.meta.url)

  // duckdb-node.cjs serves as both the main-thread library and worker entrypoint.
  // In worker mode (isMainThread === false) it reads workerData.mod and loads it,
  // bridging parentPort messages to globalThis.onmessage/postMessage for the
  // actual EH worker script.
  const nodeBundlePath = require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node')

  const listeners = new Map<string, Array<(e: MessageEvent) => void>>()
  const nodeWorker = new NodeWorker(nodeBundlePath, {
    workerData: { mod: workerCjsPath },
  })

  const adapter = {
    addEventListener(
      type: string,
      listener: (e: MessageEvent) => void,
    ): void {
      let bucket = listeners.get(type)
      if (!bucket) {
        bucket = []
        listeners.set(type, bucket)
      }
      bucket.push(listener)
    },
    removeEventListener(
      type: string,
      listener: (e: MessageEvent) => void,
    ): void {
      const bucket = listeners.get(type)
      if (bucket) {
        const idx = bucket.indexOf(listener)
        if (idx !== -1) bucket.splice(idx, 1)
      }
    },
    postMessage(msg: unknown, transfer?: Transferable[]): void {
      nodeWorker.postMessage(msg, transfer as unknown as ArrayBuffer[])
    },
    terminate(): void {
      nodeWorker.terminate()
    },
  }

  function dispatch(type: string, data: unknown): void {
    const event = Object.assign(Object.create(null), {
      type,
      data,
      target: adapter,
      currentTarget: adapter,
      timeStamp: Date.now(),
    }) as MessageEvent
    const bucket = listeners.get(type)
    if (bucket) {
      for (const listener of [...bucket]) {
        try {
          listener(event)
        } catch (err) {
          console.error(err)
        }
      }
    }
  }

  nodeWorker.on('message', (data) => dispatch('message', data))
  nodeWorker.on('error', (err) => dispatch('error', err))
  nodeWorker.on('exit', () => dispatch('close', null))

  return adapter as unknown as Worker
}

async function createDb(): Promise<duckdb.AsyncDuckDB> {
  const isNode =
    typeof process !== 'undefined' && process.versions?.node != null

  let worker: Worker
  let mainModule: string

  if (isNode) {
    const bundle = getNodeBundle()
    worker = await createNodeWorkerAdapter(bundle.mainWorker)
    mainModule = bundle.mainModule
  } else {
    const bundle = await duckdb.selectBundle(getBrowserBundles())
    worker = new Worker(bundle.mainWorker!)
    mainModule = bundle.mainModule
  }

  const logger = new duckdb.VoidLogger()
  const db = new duckdb.AsyncDuckDB(logger, worker)
  await db.instantiate(mainModule)
  return db
}

let dbInstance: duckdb.AsyncDuckDB | null = null
let connInstance: duckdb.AsyncDuckDBConnection | null = null

export async function getDb(): Promise<duckdb.AsyncDuckDBConnection> {
  if (connInstance) return connInstance

  dbInstance = await createDb()
  connInstance = await dbInstance.connect()
  return connInstance
}

export async function resetDb(): Promise<void> {
  if (connInstance) {
    await connInstance.close()
    connInstance = null
  }
  if (dbInstance) {
    await dbInstance.terminate()
    dbInstance = null
  }
}
