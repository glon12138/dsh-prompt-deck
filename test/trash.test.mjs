import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applySoftDelete, applyRestore, applyPurge, parseStore } from '../dist/store.js'

const card = (id) => ({ id, title: 't', content: 'c', createdAt: 'c', updatedAt: 'u' })

test('applySoftDelete: marks deletedAt, keeps the card', () => {
  const prompts = [card('a')]
  assert.equal(applySoftDelete(prompts, 'a', 'T1'), 'ok')
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].deletedAt, 'T1')
})

test('applySoftDelete: idempotent — earliest deletedAt wins', () => {
  const prompts = [card('a')]
  applySoftDelete(prompts, 'a', 'T1')
  applySoftDelete(prompts, 'a', 'T2')
  assert.equal(prompts[0].deletedAt, 'T1')
})

test('applySoftDelete: missing id → missing', () => {
  assert.equal(applySoftDelete([], 'nope', 'T1'), 'missing')
})

test('applyRestore: clears deletedAt; missing id → missing', () => {
  const prompts = [card('a')]
  applySoftDelete(prompts, 'a', 'T1')
  assert.equal(applyRestore(prompts, 'a'), 'ok')
  assert.equal(prompts[0].deletedAt, undefined)
  assert.equal(applyRestore(prompts, 'nope'), 'missing')
})

test('applyPurge: removes the card; missing id → missing', () => {
  const prompts = [card('a')]
  assert.equal(applyPurge(prompts, 'a'), 'ok')
  assert.equal(prompts.length, 0)
  assert.equal(applyPurge(prompts, 'a'), 'missing')
})

test('parseStore: preserves deletedAt; missing deletedAt = alive', () => {
  const raw = JSON.stringify({
    prompts: [
      { id: 'alive', title: 't', content: 'c' },
      { id: 'trashed', title: 't', content: 'c', deletedAt: 'T1' },
    ],
  })
  const store = parseStore(raw)
  assert.equal(store.prompts[0].deletedAt, undefined)
  assert.equal(store.prompts[1].deletedAt, 'T1')
})
