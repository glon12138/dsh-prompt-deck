import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeImported } from '../dist/store.js'

const card = (id, over = {}) => ({ id, title: 't', content: 'c', createdAt: 'c', updatedAt: 'u', ...over })
const gen = () => 'generated-id'

test('mergeImported: adds cards that have no id, assigns genId', () => {
  const { prompts, added, skipped, invalid } = mergeImported(
    [card('local')],
    [{ id: '', title: 'n', content: 'c' }, { title: 'no-id-field', content: 'c' }],
    'NOW', gen)
  assert.equal(added, 2)
  assert.equal(skipped, 0)
  assert.equal(invalid, 0)
  assert.equal(prompts.length, 3)
  assert.equal(prompts[1].id, 'generated-id')
  assert.equal(prompts[1].updatedAt, 'NOW')
  assert.equal(prompts[1].createdAt, '') // no timestamp in source → keep parse default
})

test('mergeImported: colliding ids are skipped (local edits win), idempotent re-import', () => {
  const existing = [card('dup', { title: '本地改过' })]
  const first = mergeImported(existing, [card('dup', { title: '备份版' })], 'NOW', gen)
  assert.equal(first.added, 0)
  assert.equal(first.skipped, 1)
  assert.equal(first.prompts[0].title, '本地改过')
  // importing the same backup twice yields the same store
  const second = mergeImported(first.prompts, [card('dup', { title: '备份版' })], 'NOW', gen)
  assert.equal(second.added, 0)
  assert.deepEqual(second.prompts, first.prompts)
})

test('mergeImported: malformed entries counted invalid, never added', () => {
  const { prompts, added, invalid } = mergeImported(
    [],
    [null, 7, { id: 1 }, { id: 'x', title: 't' }, { id: 'ok', title: 't', content: 'c' }],
    'NOW', gen)
  assert.equal(invalid, 4)
  assert.equal(added, 1)
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].id, 'ok')
})

test('mergeImported: oversized title/content → invalid', () => {
  const { added, invalid } = mergeImported(
    [],
    [{ id: 'big', title: 'x'.repeat(201), content: 'c' },
     { id: 'big2', title: 't', content: 'x'.repeat(100_001) }],
    'NOW', gen)
  assert.equal(added, 0)
  assert.equal(invalid, 2)
})

test('mergeImported: garbage tags/group coerce to defaults, valid ones kept', () => {
  const { prompts } = mergeImported(
    [],
    [{ id: 'a', title: 't', content: 'c', tags: ['ok', 5], group: 7 }],
    'NOW', gen)
  assert.deepEqual(prompts[0].tags, ['ok'])
  assert.equal(prompts[0].group, '')
})

test('mergeImported: id-less entry matching existing title+content is skipped', () => {
  const existing = [card('keep', { title: '同款', content: '同样内容' })]
  const { added, skipped } = mergeImported(
    existing,
    [{ title: '同款', content: '同样内容' }],
    'NOW', gen)
  assert.equal(added, 0)
  assert.equal(skipped, 1)
})
