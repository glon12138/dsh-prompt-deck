import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseStore, seedStore } from '../dist/store.js'

test('parseStore: v0.1 legacy store (no deletedAt/tags/group) loads intact', () => {
  const raw = JSON.stringify({
    prompts: [
      { id: 'a', title: '标题', content: '内容', createdAt: 'c', updatedAt: 'u' },
    ],
  })
  const store = parseStore(raw)
  assert.equal(store.prompts.length, 1)
  assert.equal(store.prompts[0].id, 'a')
  assert.equal(store.prompts[0].title, '标题')
  assert.equal(store.prompts[0].content, '内容')
  assert.equal(store.prompts[0].createdAt, 'c')
  assert.equal(store.prompts[0].updatedAt, 'u')
})

test('parseStore: malformed entries are dropped, valid ones kept', () => {
  const raw = JSON.stringify({
    prompts: [null, 42, { id: 1, title: 'x', content: 'y' }, { id: 'ok', title: 't', content: 'c' }],
  })
  const store = parseStore(raw)
  assert.equal(store.prompts.length, 1)
  assert.equal(store.prompts[0].id, 'ok')
})

test('parseStore: invalid JSON throws loudly', () => {
  assert.throws(() => parseStore('{ not json'), /not valid JSON/)
})

test('parseStore: wrong shape throws', () => {
  assert.throws(() => parseStore('{"cards":[]}'), /must have the shape/)
})

test('seedStore: returns 4 independent seed cards each call', () => {
  const a = seedStore()
  const b = seedStore()
  assert.equal(a.prompts.length, 4)
  assert.notEqual(a.prompts, b.prompts)
  a.prompts.pop()
  assert.equal(b.prompts.length, 4)
})
