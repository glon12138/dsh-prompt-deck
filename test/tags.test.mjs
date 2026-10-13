import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTags, normalizeGroup, parseStore } from '../dist/store.js'

test('normalizeTags: undefined/null → []', () => {
  assert.deepEqual(normalizeTags(undefined), [])
  assert.deepEqual(normalizeTags(null), [])
})

test('normalizeTags: trims, drops empties, dedupes', () => {
  assert.deepEqual(normalizeTags(['  a ', 'b', 'a', '', ' ']), ['a', 'b'])
})

test('normalizeTags: non-array / non-string entries → null', () => {
  assert.equal(normalizeTags('a,b'), null)
  assert.equal(normalizeTags(['a', 1]), null)
})

test('normalizeTags: over the 20-tag or 50-char limits → null', () => {
  assert.equal(normalizeTags(Array.from({ length: 21 }, (_, i) => `t${i}`)), null)
  assert.equal(normalizeTags(['x'.repeat(51)]), null)
})

test('normalizeGroup: trims, empty ok, non-string or too long → null', () => {
  assert.equal(normalizeGroup(undefined), '')
  assert.equal(normalizeGroup('  工作流  '), '工作流')
  assert.equal(normalizeGroup(42), null)
  assert.equal(normalizeGroup('x'.repeat(51)), null)
})

test('parseStore: legacy entries get tags=[] and group=""', () => {
  const raw = JSON.stringify({ prompts: [{ id: 'a', title: 't', content: 'c' }] })
  const store = parseStore(raw)
  assert.deepEqual(store.prompts[0].tags, [])
  assert.equal(store.prompts[0].group, '')
})

test('parseStore: lenient path truncates tags to 50 chars and dedupes', () => {
  const raw = JSON.stringify({
    prompts: [
      {
        id: 'a',
        title: 't',
        content: 'c',
        tags: ['x'.repeat(10_000), 'dup', 'dup', '  dup  '],
        group: 'g'.repeat(1000),
      },
    ],
  })
  const store = parseStore(raw)
  assert.deepEqual(store.prompts[0].tags, ['x'.repeat(50), 'dup'])
  assert.equal(store.prompts[0].group.length, 50)
})

test('parseStore: tags/group preserved; invalid tags coerced to []', () => {
  const raw = JSON.stringify({
    prompts: [
      { id: 'a', title: 't', content: 'c', tags: ['x', ' y '], group: 'G' },
      { id: 'b', title: 't', content: 'c', tags: 'nope', group: 7 },
    ],
  })
  const store = parseStore(raw)
  assert.deepEqual(store.prompts[0].tags, ['x', 'y'])
  assert.equal(store.prompts[0].group, 'G')
  assert.deepEqual(store.prompts[1].tags, [])
  assert.equal(store.prompts[1].group, '')
})
