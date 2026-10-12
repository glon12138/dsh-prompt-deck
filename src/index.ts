// dsh-prompt-deck — HOST half: prompt-deck JSON storage + HTTP routes.
//
// Routes (same-origin, JSON in / JSON out, method-gated in the handler):
//   GET  /__prompt-deck/list    → { ok, prompts }  (materializes an empty store on first run)
//   POST /__prompt-deck/save    → upsert one card  { id?, title, content } → { ok, prompt }
//   POST /__prompt-deck/delete  → remove one card   { id } → { ok, id }
//   GET  /dsh-prompt-deck/ping  → health check
//
// Storage: ~/.dsh/prompt-deck.json
//   - every operation reads the file fresh and runs through ONE promise chain,
//     so concurrent requests cannot interleave read-modify-write;
//   - writes land via tmp-file + rename, so a crash never leaves a half-written store;
//   - a missing file materializes an empty store; a corrupted file fails loudly
//     (500 + message) instead of silently overwriting user data.
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-prompt-deck'

// Wait until the host's HTTP server (`ctx.webServer`) is ready before running.
export const inject = ['webServer']

export interface PromptItem {
  id: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
}

interface Store {
  prompts: PromptItem[]
}

// Minimal typed view of the webServer seam. The full API lives in
// @deepseek-ai/dsh-web-server; a plugin only needs `register` (which returns a
// disposer — call it to unregister, inside ctx.effect cleanup).
interface RouteSpec {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: any, res: any) => void | Promise<void>
}
type WebServer = { register: (spec: RouteSpec) => () => void }

const DATA_DIR = join(homedir(), '.dsh')
const DATA_FILE = join(DATA_DIR, 'prompt-deck.json')
const MAX_BODY_BYTES = 1024 * 1024 // request body cap: 1 MiB
const MAX_TITLE = 200
const MAX_CONTENT = 100_000

// First-run seeds: written exactly once, when the store file does not exist.
// Stable ids keep them recognizable; deleting a seed is a normal delete and
// never re-triggers seeding (the file then exists).
const SEED_AT = '2026-10-12T00:00:00.000Z'
const SEEDS: PromptItem[] = [
  {
    id: 'seed-code-review',
    title: '代码审查',
    content:
      '请审查以下代码，重点关注：\n1. 边界条件与错误处理\n2. 并发与资源安全\n3. 可读性与命名\n按严重程度列出问题，并给出修改建议。',
    createdAt: SEED_AT,
    updatedAt: SEED_AT,
  },
  {
    id: 'seed-translate',
    title: '翻译（中↔英）',
    content:
      '将以下内容翻译成目标语言，要求：\n- 语气自然，符合目标语言习惯\n- 术语保留原文，首次出现时括注\n- 不改写专有名词与代码片段',
    createdAt: SEED_AT,
    updatedAt: SEED_AT,
  },
  {
    id: 'seed-summarize',
    title: '总结要点',
    content:
      '用不超过5条要点总结以下内容：\n- 每条一行，突出可执行结论\n- 保留关键数字与时间\n- 最后用一句话给出建议的下一步',
    createdAt: SEED_AT,
    updatedAt: SEED_AT,
  },
  {
    id: 'seed-explain-code',
    title: '解释代码',
    content:
      '解释以下代码片段：\n- 先用一句话说明整体用途\n- 再按逻辑分块解释关键语句\n- 指出潜在的坑与性能注意点',
    createdAt: SEED_AT,
    updatedAt: SEED_AT,
  },
]

// ── store IO ────────────────────────────────────────────────────────────────

async function readStore(): Promise<Store> {
  const raw = await fs.readFile(DATA_FILE, 'utf8') // ENOENT propagates (code === 'ENOENT')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    // Fail loudly: never overwrite a corrupted store with a fresh one.
    throw new Error(`prompt-deck.json is not valid JSON: ${(e as Error).message}`)
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { prompts?: unknown }).prompts)) {
    throw new Error('prompt-deck.json must have the shape { "prompts": [...] }')
  }
  // Lenient per-entry: keep well-formed cards, drop malformed ones.
  const prompts: PromptItem[] = []
  for (const entry of (parsed as { prompts: unknown[] }).prompts) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    if (typeof e.id !== 'string' || typeof e.title !== 'string' || typeof e.content !== 'string') continue
    prompts.push({
      id: e.id,
      title: e.title,
      content: e.content,
      createdAt: typeof e.createdAt === 'string' ? e.createdAt : '',
      updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : '',
    })
  }
  return { prompts }
}

async function writeStore(store: Store): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  const tmp = `${DATA_FILE}.${process.pid}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  await fs.rename(tmp, DATA_FILE)
}

// Serialize every read-modify-write through one chain (list included, so a
// read never observes a half-applied batch of writes).
let chain: Promise<unknown> = Promise.resolve()
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task)
  chain = run.catch(() => undefined)
  return run
}

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
    const seeded: Store = { prompts: SEEDS.map((p) => ({ ...p })) }
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

  return serialized(async (): Promise<Outcome> => {
    const store = await readStoreOrEmpty()
    if ('status' in store) return store
    const now = new Date().toISOString()

    if (id === undefined) {
      const prompt: PromptItem = { id: randomUUID(), title, content, createdAt: now, updatedAt: now }
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
    const index = store.prompts.findIndex((p) => p.id === id)
    if (index === -1) return fail(404, 'prompt not found')
    store.prompts.splice(index, 1)
    try {
      await writeStore(store)
    } catch (e) {
      return fail(500, `failed to write prompt store: ${(e as Error).message}`)
    }
    return ok({ id })
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
    ]
    console.log('[dsh-prompt-deck] routes ready: /dsh-prompt-deck/ping, /__prompt-deck/{list,save,delete}')
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'dsh-prompt-deck: routes')
}
