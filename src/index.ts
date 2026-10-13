// dsh-prompt-deck — HOST half: prompt-deck JSON storage + HTTP routes.
//
// Routes (same-origin, JSON in / JSON out, method-gated in the handler):
//   GET  /__prompt-deck/list    → { ok, prompts }  (materializes an empty store on first run)
//   POST /__prompt-deck/save    → upsert one card  { id?, title, content, tags?, group? } → { ok, prompt }
//   POST /__prompt-deck/delete  → soft-delete one card (to trash) { id } → { ok, id, deletedAt }
//   POST /__prompt-deck/restore → un-trash one card  { id } → { ok, id }
//   POST /__prompt-deck/purge   → permanently remove { id } → { ok, id }
//   GET  /__prompt-deck/export  → full backup incl. trash → { ok, version, exportedAt, prompts }
//   POST /__prompt-deck/import  → merge prompts (array or { prompts }) → { ok, added, skipped, invalid }
//   GET  /dsh-prompt-deck/ping  → health check
//
// Storage: ~/.dsh/prompt-deck.json — the whole storage layer (types, parse,
// seeds, IO, serialized chain) lives in src/store.ts; this file is routes only.
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import {
  applyPurge,
  applyRestore,
  applySoftDelete,
  MAX_CONTENT,
  MAX_GROUP,
  MAX_TAG_LEN,
  MAX_TAGS,
  MAX_TITLE,
  mergeImported,
  normalizeGroup,
  normalizeTags,
  readStore,
  seedStore,
  serialized,
  writeStore,
} from './store.ts'
import type { PromptItem, Store } from './store.ts'

export const name = 'dsh-prompt-deck'

// Wait until the host's HTTP server (`ctx.webServer`) is ready before running.
export const inject = ['webServer']

// Minimal typed view of the webServer seam. The full API lives in
// @deepseek-ai/dsh-web-server; a plugin only needs `register` (which returns a
// disposer — call it to unregister, inside ctx.effect cleanup).
interface RouteSpec {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: any, res: any) => void | Promise<void>
}
type WebServer = { register: (spec: RouteSpec) => () => void }

const MAX_BODY_BYTES = 1024 * 1024 // request body cap: 1 MiB

// ── HTTP helpers ────────────────────────────────────────────────────────────

interface Outcome {
  status: number
  body: unknown
}

const ok = (body: Record<string, unknown>): Outcome => ({ status: 200, body: { ok: true, ...body } })
const fail = (status: number, error: string): Outcome => ({ status, body: { ok: false, error } })

function send(res: any, status: number, body: unknown): void {
  const buf = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': buf.length,
  })
  res.end(buf)
}

function readJsonBody(req: any): Promise<any | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('request body too large'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(undefined)
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(Object.assign(new Error('request body is not valid JSON'), { status: 400 }))
      }
    })
    req.on('error', (e: Error) => reject(e))
  })
}

const readErrorMessage = (e: unknown): string =>
  (e as Error)?.message ?? 'failed to read prompt store'

// Read the store; on first run (file missing) materialize it with the seeds.
async function readStoreOrEmpty(): Promise<Store | Outcome> {
  try {
    return await readStore()
  } catch (e: any) {
    if (e?.code !== 'ENOENT') return fail(500, readErrorMessage(e))
    const seeded = seedStore()
    try {
      await writeStore(seeded)
    } catch (writeErr) {
      // Serving the seeds in-memory is still useful; the file write can fail
      // on a read-only home and will be retried on the next write.
      console.error('[dsh-prompt-deck] first-run seed write failed:', writeErr)
    }
    return seeded
  }
}

// ── route handlers ──────────────────────────────────────────────────────────

async function handleList(): Promise<Outcome> {
  return serialized(async () => {
    const store = await readStoreOrEmpty()
    if ('status' in store) return store // read error → 500
    return ok({ prompts: store.prompts })
  })
}

async function handleSave(req: any): Promise<Outcome> {
  let body: any
  try {
    body = await readJsonBody(req)
  } catch (e: any) {
    return fail(e?.status ?? 400, e?.message ?? 'bad request')
  }

  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  const content = typeof body?.content === 'string' ? body.content.trim() : ''
  const id = body?.id === undefined || body?.id === null || body.id === '' ? undefined : String(body.id)
  if (!title || !content) return fail(400, 'title and content are required')
  if (title.length > MAX_TITLE) return fail(400, `title too long (max ${MAX_TITLE} characters)`)
  if (content.length > MAX_CONTENT) return fail(400, `content too long (max ${MAX_CONTENT} characters)`)
  const tags = normalizeTags(body?.tags)
  const group = normalizeGroup(body?.group)
  if (tags === null) return fail(400, `tags must be up to ${MAX_TAGS} strings of ${MAX_TAG_LEN} characters each`)
  if (group === null) return fail(400, `group must be a string of at most ${MAX_GROUP} characters`)

  return serialized(async (): Promise<Outcome> => {
    const store = await readStoreOrEmpty()
    if ('status' in store) return store
    const now = new Date().toISOString()

    if (id === undefined) {
      const prompt: PromptItem = { id: randomUUID(), title, content, tags, group, createdAt: now, updatedAt: now }
      store.prompts.push(prompt)
      try {
        await writeStore(store)
      } catch (e) {
        return fail(500, `failed to write prompt store: ${(e as Error).message}`)
      }
      return ok({ prompt })
    }

    const found = store.prompts.find((p) => p.id === id)
    if (!found) return fail(404, 'prompt not found')
    found.title = title
    found.content = content
    found.tags = tags
    found.group = group
    found.updatedAt = now
    try {
      await writeStore(store)
    } catch (e) {
      return fail(500, `failed to write prompt store: ${(e as Error).message}`)
    }
    return ok({ prompt: found })
  })
}

async function handleDelete(req: any): Promise<Outcome> {
  let body: any
  try {
    body = await readJsonBody(req)
  } catch (e: any) {
    return fail(e?.status ?? 400, e?.message ?? 'bad request')
  }
  const id = typeof body?.id === 'string' && body.id !== '' ? body.id : undefined
  if (!id) return fail(400, 'id is required')

  return serialized(async (): Promise<Outcome> => {
    const store = await readStoreOrEmpty()
    if ('status' in store) return store
    const result = applySoftDelete(store.prompts, id, new Date().toISOString())
    if (result === 'missing') return fail(404, 'prompt not found')
    try {
      await writeStore(store)
    } catch (e) {
      return fail(500, `failed to write prompt store: ${(e as Error).message}`)
    }
    return ok({ id, deletedAt: store.prompts.find((p) => p.id === id)?.deletedAt })
  })
}

async function handleRestore(req: any): Promise<Outcome> {
  let body: any
  try {
    body = await readJsonBody(req)
  } catch (e: any) {
    return fail(e?.status ?? 400, e?.message ?? 'bad request')
  }
  const id = typeof body?.id === 'string' && body.id !== '' ? body.id : undefined
  if (!id) return fail(400, 'id is required')

  return serialized(async (): Promise<Outcome> => {
    const store = await readStoreOrEmpty()
    if ('status' in store) return store
    const result = applyRestore(store.prompts, id)
    if (result === 'missing') return fail(404, 'prompt not found')
    try {
      await writeStore(store)
    } catch (e) {
      return fail(500, `failed to write prompt store: ${(e as Error).message}`)
    }
    return ok({ id })
  })
}

async function handlePurge(req: any): Promise<Outcome> {
  let body: any
  try {
    body = await readJsonBody(req)
  } catch (e: any) {
    return fail(e?.status ?? 400, e?.message ?? 'bad request')
  }
  const id = typeof body?.id === 'string' && body.id !== '' ? body.id : undefined
  if (!id) return fail(400, 'id is required')

  return serialized(async (): Promise<Outcome> => {
    const store = await readStoreOrEmpty()
    if ('status' in store) return store
    const result = applyPurge(store.prompts, id)
    if (result === 'missing') return fail(404, 'prompt not found')
    try {
      await writeStore(store)
    } catch (e) {
      return fail(500, `failed to write prompt store: ${(e as Error).message}`)
    }
    return ok({ id })
  })
}

async function handleExport(): Promise<Outcome> {
  return serialized(async () => {
    const store = await readStoreOrEmpty()
    if ('status' in store) return store
    // Full dump incl. trash: a backup must survive reinstall.
    return ok({ version: 2, exportedAt: new Date().toISOString(), prompts: store.prompts })
  })
}

async function handleImport(req: any): Promise<Outcome> {
  let body: any
  try {
    body = await readJsonBody(req)
  } catch (e: any) {
    return fail(e?.status ?? 400, e?.message ?? 'bad request')
  }
  const list = Array.isArray(body)
    ? body
    : Array.isArray(body?.prompts)
      ? body.prompts
      : null
  if (!list) return fail(400, 'body must be an array of prompts or { prompts: [...] }')

  return serialized(async (): Promise<Outcome> => {
    const store = await readStoreOrEmpty()
    if ('status' in store) return store
    const { prompts, added, skipped, invalid } = mergeImported(
      store.prompts, list, new Date().toISOString(), randomUUID)
    if (added === 0) return ok({ added, skipped, invalid }) // nothing new → no write
    store.prompts = prompts
    try {
      await writeStore(store)
    } catch (e) {
      return fail(500, `failed to write prompt store: ${(e as Error).message}`)
    }
    return ok({ added, skipped, invalid })
  })
}

// ── plugin entry ────────────────────────────────────────────────────────────

export function apply(ctx: Context) {
  const ws = (ctx as unknown as { webServer: WebServer }).webServer

  // Method gate + last-resort error barrier: a handler must always respond.
  const route = (method: string, handler: (req: any, res: any) => Promise<Outcome>) =>
    async (req: any, res: any) => {
      if (req.method !== method) {
        send(res, 405, { ok: false, error: `method not allowed, use ${method}` })
        return
      }
      let outcome: Outcome
      try {
        outcome = await handler(req, res)
      } catch (e) {
        outcome = fail(500, (e as Error)?.message ?? 'internal error')
      }
      send(res, outcome.status, outcome.body)
    }

  ctx.effect(() => {
    const disposers = [
      ws.register({
        kind: 'exact',
        path: '/dsh-prompt-deck/ping',
        // Evaluated per request, not at registration time.
        handler: (_req: any, res: any) =>
          send(res, 200, { ok: true, plugin: 'dsh-prompt-deck', time: new Date().toISOString() }),
      }),
      ws.register({ kind: 'exact', path: '/__prompt-deck/list', handler: route('GET', () => handleList()) }),
      ws.register({ kind: 'exact', path: '/__prompt-deck/save', handler: route('POST', (req) => handleSave(req)) }),
      ws.register({ kind: 'exact', path: '/__prompt-deck/delete', handler: route('POST', (req) => handleDelete(req)) }),
      ws.register({ kind: 'exact', path: '/__prompt-deck/restore', handler: route('POST', (req) => handleRestore(req)) }),
      ws.register({ kind: 'exact', path: '/__prompt-deck/purge', handler: route('POST', (req) => handlePurge(req)) }),
      ws.register({ kind: 'exact', path: '/__prompt-deck/export', handler: route('GET', () => handleExport()) }),
      ws.register({ kind: 'exact', path: '/__prompt-deck/import', handler: route('POST', (req) => handleImport(req)) }),
    ]
    console.log('[dsh-prompt-deck] routes ready: /dsh-prompt-deck/ping, /__prompt-deck/{list,save,delete,restore,purge,export,import}')
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'dsh-prompt-deck: routes')
}
