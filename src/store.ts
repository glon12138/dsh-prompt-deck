// dsh-prompt-deck — storage layer: card type, JSON store IO, seeds.
//
// Contract:
//   - parseStore is pure (string → Store): JSON/shape errors throw, malformed
//     entries are dropped leniently — one bad field never nukes user data;
//   - every host read-modify-write runs through serialized(), so concurrent
//     requests cannot interleave;
//   - writeStore lands via tmp-file + rename, so a crash never leaves a
//     half-written store.
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface PromptItem {
  id: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
  /** Free-form tags for filtering; always present after parse (default []). */
  tags: string[]
  /** Optional single group label; '' = ungrouped. */
  group: string
  /** Present = in the trash; absent = alive. */
  deletedAt?: string
}

export interface Store {
  prompts: PromptItem[]
}

export const DATA_DIR = join(homedir(), '.dsh')
export const DATA_FILE = join(DATA_DIR, 'prompt-deck.json')
export const MAX_TITLE = 200
export const MAX_CONTENT = 100_000
export const MAX_TAGS = 20
export const MAX_TAG_LEN = 50
export const MAX_GROUP = 50

// First-run seeds: written exactly once, when the store file does not exist.
// Stable ids keep them recognizable; deleting a seed is a normal delete and
// never re-triggers seeding (the file then exists).
const SEED_AT = '2026-10-12T00:00:00.000Z'
const SEEDS: Array<Omit<PromptItem, 'tags' | 'group'>> = [
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

export function seedStore(): Store {
  return { prompts: SEEDS.map((p) => ({ tags: [], group: '', ...p })) }
}

// Lenient per-entry: keep well-formed cards, drop malformed ones.
export function normalizeEntry(entry: unknown): PromptItem | null {
  if (typeof entry !== 'object' || entry === null) return null
  const e = entry as Record<string, unknown>
  if (typeof e.id !== 'string' || typeof e.title !== 'string' || typeof e.content !== 'string') return null
  return {
    id: e.id,
    title: e.title,
    content: e.content,
    createdAt: typeof e.createdAt === 'string' ? e.createdAt : '',
    updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : '',
    tags: Array.isArray(e.tags)
      ? e.tags
          .filter((x): x is string => typeof x === 'string')
          .map((x) => x.trim())
          .filter((x) => x !== '')
          .slice(0, MAX_TAGS)
      : [],
    group: typeof e.group === 'string' ? e.group.trim().slice(0, MAX_GROUP) : '',
    deletedAt: typeof e.deletedAt === 'string' ? e.deletedAt : undefined,
  }
}

// Strict validation for the interactive save path (bad input → 400).
export function normalizeTags(input: unknown): string[] | null {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input) || input.length > MAX_TAGS) return null
  const out: string[] = []
  for (const raw of input) {
    if (typeof raw !== 'string') return null
    const tag = raw.trim()
    if (tag === '') continue // trim-empties are dropped, not rejected
    if (tag.length > MAX_TAG_LEN) return null
    if (!out.includes(tag)) out.push(tag)
  }
  return out
}

export function normalizeGroup(input: unknown): string | null {
  if (input === undefined || input === null) return ''
  if (typeof input !== 'string') return null
  const group = input.trim()
  if (group.length > MAX_GROUP) return null
  return group
}

export function parseStore(raw: string): Store {
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
  const prompts: PromptItem[] = []
  for (const entry of (parsed as { prompts: unknown[] }).prompts) {
    const card = normalizeEntry(entry)
    if (card) prompts.push(card)
  }
  return { prompts }
}

export async function readStore(): Promise<Store> {
  const raw = await fs.readFile(DATA_FILE, 'utf8') // ENOENT propagates (code === 'ENOENT')
  return parseStore(raw)
}

export async function writeStore(store: Store): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  const tmp = `${DATA_FILE}.${process.pid}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  await fs.rename(tmp, DATA_FILE)
}

// Serialize every read-modify-write through one chain (list included, so a
// read never observes a half-applied batch of writes).
let chain: Promise<unknown> = Promise.resolve()
export function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task)
  chain = run.catch(() => undefined)
  return run
}

// ── trash (soft delete) ─────────────────────────────────────────────────────

export function applySoftDelete(prompts: PromptItem[], id: string, now: string): 'ok' | 'missing' {
  const p = prompts.find((x) => x.id === id)
  if (!p) return 'missing'
  if (p.deletedAt === undefined) p.deletedAt = now // earliest wins: idempotent
  return 'ok'
}

export function applyRestore(prompts: PromptItem[], id: string): 'ok' | 'missing' {
  const p = prompts.find((x) => x.id === id)
  if (!p) return 'missing'
  delete p.deletedAt
  return 'ok'
}

export function applyPurge(prompts: PromptItem[], id: string): 'ok' | 'missing' {
  const index = prompts.findIndex((x) => x.id === id)
  if (index === -1) return 'missing'
  prompts.splice(index, 1)
  return 'ok'
}
