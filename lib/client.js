// dsh-prompt-deck — BROWSER half: a prompt deck docked in the right Sidebar.
//
// How it loads: package.json declares `dsh.client.inject` + `exports["./client"]`;
// the DSH module loader bundles this file into the client roster. `require` here
// resolves official client modules — do NOT use bare ESM imports.
//
// Seams used:
//   - `sidebar.right.pane.tab` (keyed, session scope) — the deck's body lives in
//     the right Sidebar as its own tab type (`kind: 'prompt-deck'`); see
//     docs/subsystems/sidebar-right.md.
//   - `conversation.input.left` (list, session scope) — the launcher button
//     beside the input box; clicking it `openTab`s the deck in the Sidebar.
//   - Session standard props (`useInput` / `inputActions`) reach BOTH seats
//     automatically — every session-scope occupant receives them.
//   - `locale` for zh/en strings; `slots` for registration;
//     `sidebarRightTabs` / `sidebarRight` for the tab type and navigation.
//
// Injection contract: a card click APPENDS to the current draft
// (`setDraft(current + card)`), never overwriting what the user already typed.
window.__ModuleLoader__.load({
  id: 'dsh-prompt-deck',
  factory: (require) => {
    const React = require('react')
    const { useState, useEffect, useRef, useMemo, useCallback } = React
    const h = React.createElement

    const NS = 'dsh-prompt-deck' // unique locale namespace for this bundle
    const TAB_ID = 'dsh-prompt-deck' // tab-type id + body seat key
    const TAB_KIND = 'prompt-deck' // what openTab names
    const zh = {
      nav: '提示词卡组',
      btn: '提示词',
      search: '搜索标题或内容…',
      newBtn: '新建',
      loading: '加载中…',
      retry: '重试',
      empty: '还没有提示词，点「新建」创建第一张卡片',
      noMatch: '没有匹配的提示词',
      save: '保存',
      cancel: '取消',
      edit: '编辑',
      del: '删除',
      delConfirm: '删除这张卡片？',
      yes: '删除',
      titlePh: '标题',
      contentPh: '提示词内容…',
      required: '标题和内容都不能为空',
      saveError: '保存失败',
      delError: '删除失败',
      foot: '点击卡片 → 追加到输入框（不覆盖已有草稿）',
      guideDesc: '本地提示词卡组：搜索、编辑，点击卡片追加到输入框',
      view: '查看内容',
      collapse: '收起内容',
      append: '追加到输入框',
    }
    const en = {
      nav: 'Prompt Deck',
      btn: 'Prompts',
      search: 'Search title or content…',
      newBtn: 'New',
      loading: 'Loading…',
      retry: 'Retry',
      empty: 'No prompts yet — click New to create the first card',
      noMatch: 'No matching prompts',
      save: 'Save',
      cancel: 'Cancel',
      edit: 'Edit',
      del: 'Delete',
      delConfirm: 'Delete this card?',
      yes: 'Delete',
      titlePh: 'Title',
      contentPh: 'Prompt content…',
      required: 'Title and content are both required',
      saveError: 'Save failed',
      delError: 'Delete failed',
      foot: 'Click a card → appended to the input (keeps your draft)',
      guideDesc: 'Local prompt deck: search, edit, and append cards to the input',
      view: 'View content',
      collapse: 'Collapse',
      append: 'Append to input',
    }

    // Locale binding is created inside apply(); components read it through this
    // module-scope getter (set on apply, safe to call after mount).
    let t = (k) => k
    const setT = (fn) => { t = fn }

    // Navigation service captured at apply; the launcher button uses it.
    let sidebarRight = null

    // ── Styling contract / 样式契约 ─────────────────────────────────────
    // All colors go through --dsw-alias-* design tokens (docs/web-styling.md);
    // literal values only as fallbacks for hosts predating the alias table.
    // No per-theme selectors anywhere — tokens carry the theme.
    // 颜色一律走 --dsw-alias-* 令牌，字面量只作老宿主兜底；禁止按主题分支选择器。
    const STYLE_ID = 'dsh-prompt-deck-style'
    const CSS = `
.dpd-wrap { position: relative; display: inline-flex; }
.dpd-trigger { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 10px;
  border: none; border-radius: 6px; font-size: 12px; line-height: 1; cursor: pointer;
  color: var(--dsw-alias-label-primary, #c9d1d9);
  background: var(--dsw-alias-button-tool-bar-fill, rgba(255,255,255,0.06)); }
.dpd-trigger:hover {
  background: var(--dsw-alias-button-tool-bar-hover, rgba(255,255,255,0.10)); }
.dpd-side { display: flex; flex-direction: column; gap: 8px; box-sizing: border-box;
  width: 100%; height: 100%; min-height: 0; padding: 8px 10px; text-align: left;
  color: var(--dsw-alias-label-primary, #c9d1d9); }
.dpd-head { display: flex; gap: 8px; }
.dpd-search { flex: 1; min-width: 0; height: 30px; padding: 0 10px; font-size: 12.5px;
  color: var(--dsw-alias-label-primary, #c9d1d9);
  background: var(--dsw-alias-bg-layer-1, #161b22);
  border: 1px solid var(--dsw-alias-border-l1, #30363d); border-radius: 6px; outline: none; }
.dpd-search:focus { border-color: var(--dsw-alias-link, #58a6ff); }
.dpd-search:disabled { opacity: 0.6; }
.dpd-btn { height: 30px; padding: 0 12px; font-size: 12.5px; border: none; border-radius: 6px;
  cursor: pointer; color: var(--dsw-alias-label-primary, #c9d1d9);
  background: var(--dsw-alias-button-tool-bar-fill, rgba(255,255,255,0.06)); }
.dpd-btn:hover { background: var(--dsw-alias-button-tool-bar-hover, rgba(255,255,255,0.10)); }
.dpd-btn:disabled { opacity: 0.55; cursor: default; }
.dpd-btn-primary { color: var(--dsw-alias-label-primary-foreground, #ffffff);
  background: var(--dsw-alias-button-primary-fill, #238636); }
.dpd-btn-primary:hover { background: var(--dsw-alias-button-primary-hover, #2ea043); }
.dpd-btn-danger { color: var(--dsw-alias-state-error-primary, #f85149); background: transparent; }
.dpd-btn-danger:hover { background: var(--dsw-alias-interactive-bg-hover-danger, rgba(248,81,73,0.12)); }
.dpd-body { flex: 1; min-height: 0; overflow: auto; }
.dpd-hint { padding: 24px 12px; font-size: 12.5px; line-height: 1.6; text-align: center;
  color: var(--dsw-alias-label-secondary, #8b949e); }
.dpd-error { display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 8px 10px; font-size: 12px; border-radius: 6px;
  color: var(--dsw-alias-state-error-primary, #f85149);
  background: var(--dsw-alias-state-error-secondary, rgba(248,81,73,0.10));
  border: 1px solid var(--dsw-alias-state-error-primary, #f85149); }
.dpd-error .dpd-btn { height: 24px; padding: 0 8px; font-size: 12px; color: var(--dsw-alias-state-error-primary, #f85149); background: transparent; }
.dpd-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.dpd-item { display: flex; flex-direction: column; border-radius: 6px; }
.dpd-item:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.05)); }
.dpd-item-row { display: flex; align-items: stretch; gap: 2px; }
.dpd-preview { display: flex; flex-direction: column; gap: 6px; padding: 2px 8px 8px 32px; }
.dpd-preview-text { max-height: 260px; overflow: auto; white-space: pre-wrap; word-break: break-word;
  padding: 8px 10px; font-size: 12.5px; line-height: 1.6;
  color: var(--dsw-alias-label-primary, #c9d1d9);
  background: var(--dsw-alias-bg-layer-1, #161b22);
  border: 1px solid var(--dsw-alias-border-l1, #30363d); border-radius: 6px; }
.dpd-preview-ops { display: flex; justify-content: flex-end; }
.dpd-item-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;
  padding: 7px 8px; border: none; border-radius: 6px; background: transparent;
  cursor: pointer; text-align: left; color: inherit; }
.dpd-item-title { font-size: 12.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  color: var(--dsw-alias-label-primary, #c9d1d9); }
.dpd-item-preview { font-size: 11.5px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  color: var(--dsw-alias-label-secondary, #8b949e); }
.dpd-item-op { width: 26px; border: none; border-radius: 6px; background: transparent; cursor: pointer;
  font-size: 12px; color: var(--dsw-alias-label-secondary, #8b949e); }
.dpd-item-toggle { font-size: 10px; }
.dpd-item-op:hover { color: var(--dsw-alias-label-primary, #c9d1d9);
  background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.08)); }
.dpd-item-op:disabled { opacity: 0.5; cursor: default; }
.dpd-confirm { flex: 1; display: flex; align-items: center; justify-content: flex-end; gap: 6px;
  padding: 6px 8px; font-size: 12px; color: var(--dsw-alias-state-error-primary, #f85149); }
.dpd-confirm .dpd-btn { height: 24px; padding: 0 8px; font-size: 12px; }
.dpd-editor { display: flex; flex-direction: column; gap: 8px; padding: 4px 0; }
.dpd-input, .dpd-textarea { width: 100%; box-sizing: border-box; padding: 7px 9px; font-size: 12.5px;
  font-family: inherit; color: var(--dsw-alias-label-primary, #c9d1d9);
  background: var(--dsw-alias-bg-layer-1, #161b22);
  border: 1px solid var(--dsw-alias-border-l1, #30363d); border-radius: 6px; outline: none; }
.dpd-textarea { min-height: 112px; resize: vertical; line-height: 1.5; }
.dpd-input:focus, .dpd-textarea:focus { border-color: var(--dsw-alias-link, #58a6ff); }
.dpd-editor-error { font-size: 12px; color: var(--dsw-alias-state-error-primary, #f85149); }
.dpd-editor-ops { display: flex; justify-content: flex-end; gap: 8px; }
.dpd-foot { padding-top: 6px; font-size: 11px; line-height: 1.5; text-align: center;
  color: var(--dsw-alias-label-caption, #6e7681); border-top: 1px solid var(--dsw-alias-border-l1, #30363d); }
`

    function ensureStyle() {
      try {
        if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
        const el = document.createElement('style')
        el.id = STYLE_ID
        el.textContent = CSS
        document.head.appendChild(el)
      } catch (e) {
        console.warn('[dsh-prompt-deck] style injection failed:', e)
      }
    }

    // ── host API ────────────────────────────────────────────────────────
    const BASE = '/__prompt-deck'
    async function call(path, body) {
      const init = body === undefined ? {} : {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }
      const res = await fetch(BASE + path, init)
      let data = null
      try { data = await res.json() } catch { /* non-JSON response */ }
      if (!res.ok || !data || data.ok !== true) {
        throw new Error((data && data.error) || ('HTTP ' + res.status))
      }
      return data
    }
    const api = {
      list: () => call('/list'),
      save: (payload) => call('/save', payload),
      del: (id) => call('/delete', { id }),
    }

    const firstLine = (s) => {
      const line = String(s || '').split('\n')[0]
      return line.length > 120 ? line.slice(0, 120) + '…' : line
    }

    // ── one row of the list: inject target + edit/delete ops ────────────
    function CardRow({ item, disabled, onInject, onEdit, onDelete }) {
      const [confirming, setConfirming] = useState(false)
      const [expanded, setExpanded] = useState(false) // inline full-content view
      const showPreview = expanded && !confirming
      const appendAndCollapse = () => { onInject(item); setExpanded(false) }
      return h('li', { className: 'dpd-item', 'data-dsh-plugin': 'dsh-prompt-deck', 'data-dsh-part': 'item' },
        h('div', { className: 'dpd-item-row' },
          confirming
            ? h('div', { className: 'dpd-confirm' },
                h('span', null, t('delConfirm')),
                h('button', {
                  className: 'dpd-btn dpd-btn-danger',
                  disabled,
                  onClick: async () => {
                    const done = await onDelete(item)
                    if (!done) setConfirming(false) // failed → back out, banner shows why
                  },
                }, t('yes')),
                h('button', { className: 'dpd-btn', disabled, onClick: () => setConfirming(false) }, t('cancel')),
              )
            : h(React.Fragment, null,
                h('button', {
                  className: 'dpd-item-op dpd-item-toggle',
                  title: expanded ? t('collapse') : t('view'),
                  'aria-expanded': expanded,
                  'data-dsh-plugin': 'dsh-prompt-deck',
                  'data-dsh-part': 'toggle',
                  disabled,
                  onClick: () => setExpanded((v) => !v),
                }, expanded ? '▾' : '▸'),
                h('button', {
                  className: 'dpd-item-main',
                  title: item.content,
                  onClick: () => onInject(item),
                },
                  h('span', { className: 'dpd-item-title' }, item.title),
                  h('span', { className: 'dpd-item-preview' }, firstLine(item.content)),
                ),
                h('button', {
                  className: 'dpd-item-op',
                  title: t('edit'),
                  disabled,
                  onClick: () => onEdit(item),
                }, '✎'),
                h('button', {
                  className: 'dpd-item-op',
                  title: t('del'),
                  disabled,
                  onClick: () => setConfirming(true),
                }, '🗑'),
              ),
        ),
        showPreview
          ? h('div', { className: 'dpd-preview', 'data-dsh-plugin': 'dsh-prompt-deck', 'data-dsh-part': 'preview' },
              h('div', { className: 'dpd-preview-text' }, item.content),
              h('div', { className: 'dpd-preview-ops' },
                h('button', { className: 'dpd-btn dpd-btn-primary', disabled, onClick: appendAndCollapse }, t('append')),
              ),
            )
          : null,
      )
    }

    // ── the deck body, rendered inside the right Sidebar tab ────────────
    // Session standard props (useInput / inputActions) arrive automatically:
    // every session-scope seat receives them. useTabInfo comes from the slot's
    // injected hook face (sidebar.right.pane.tab).
    function DeckPanel(props) {
      const draft = props.useInput((s) => s.draft)
      const inputActions = props.inputActions
      const useTabInfo = props.useTabInfo
      const visible = useTabInfo ? useTabInfo().tab.visible : true

      const [items, setItems] = useState(null) // null = loading, array = loaded
      const [query, setQuery] = useState('')
      const [error, setError] = useState(null) // panel-level (load / refresh / delete)
      const [editor, setEditor] = useState(null) // null | { id, title, content }
      const [editorError, setEditorError] = useState(null)
      const [busy, setBusy] = useState(false)

      const searchRef = useRef(null)

      const load = useCallback(async (initial) => {
        if (initial) setItems(null)
        try {
          const data = await api.list()
          setItems(Array.isArray(data.prompts) ? data.prompts : [])
          setError(null)
        } catch (e) {
          setError(e.message || 'load failed')
          if (initial) setItems([]) // don't strand the body on "loading"
        }
      }, [])

      // Initial load when the body mounts (tab seated / switched back to).
      useEffect(() => { void load(true) }, [load])

      // Focus the search box when the tab becomes visible, or the editor settles.
      useEffect(() => {
        if (visible && searchRef.current) searchRef.current.focus()
      }, [visible, editor])

      // Card click → APPEND to the existing draft, never replace it.
      const inject = (item) => {
        const current = typeof draft === 'string' ? draft : ''
        const text = String(item.content || '')
        const merged = current === ''
          ? text
          : (current.endsWith('\n') ? current + text : current + '\n' + text)
        inputActions.setDraft(merged)
      }

      const startCreate = () => { setEditor({ id: null, title: '', content: '' }); setEditorError(null) }
      const startEdit = (item) => { setEditor({ id: item.id, title: item.title, content: item.content }); setEditorError(null) }
      const closeEditor = () => { setEditor(null); setEditorError(null) }

      const submitEditor = async () => {
        if (!editor) return
        const title = editor.title.trim()
        const content = editor.content.trim()
        if (!title || !content) { setEditorError(t('required')); return }
        setBusy(true)
        try {
          const payload = { title, content }
          if (editor.id) payload.id = editor.id
          await api.save(payload)
          setEditor(null)
          setEditorError(null)
          await load(false)
        } catch (e) {
          setEditorError(`${t('saveError')}: ${e.message}`)
        } finally {
          setBusy(false)
        }
      }

      const deleteItem = async (item) => {
        setBusy(true)
        try {
          await api.del(item.id)
          setError(null)
          await load(false)
          return true
        } catch (e) {
          setError(`${t('delError')}: ${e.message}`)
          return false
        } finally {
          setBusy(false)
        }
      }

      const filtered = useMemo(() => {
        if (!items) return []
        const q = query.trim().toLowerCase()
        if (!q) return items
        return items.filter((p) =>
          p.title.toLowerCase().includes(q) || String(p.content).toLowerCase().includes(q))
      }, [items, query])

      const onSearchKey = (e) => {
        if (e.key === 'Enter' && !editor && filtered.length > 0) inject(filtered[0])
      }

      const body = () => {
        if (editor) {
          return h('div', { className: 'dpd-editor', 'data-dsh-plugin': 'dsh-prompt-deck', 'data-dsh-part': 'editor' },
            h('input', {
              className: 'dpd-input',
              value: editor.title,
              placeholder: t('titlePh'),
              maxLength: 200,
              onChange: (e) => setEditor({ ...editor, title: e.target.value }),
            }),
            h('textarea', {
              className: 'dpd-textarea',
              value: editor.content,
              placeholder: t('contentPh'),
              onChange: (e) => setEditor({ ...editor, content: e.target.value }),
            }),
            editorError ? h('div', { className: 'dpd-editor-error' }, editorError) : null,
            h('div', { className: 'dpd-editor-ops' },
              h('button', { className: 'dpd-btn', disabled: busy, onClick: closeEditor }, t('cancel')),
              h('button', { className: 'dpd-btn dpd-btn-primary', disabled: busy, onClick: submitEditor }, t('save')),
            ),
          )
        }
        if (!items) return h('div', { className: 'dpd-hint' }, t('loading'))
        if (items.length === 0) {
          return h('div', { className: 'dpd-hint', 'data-dsh-plugin': 'dsh-prompt-deck', 'data-dsh-part': 'empty' },
            t('empty'))
        }
        if (filtered.length === 0) {
          return h('div', { className: 'dpd-hint', 'data-dsh-plugin': 'dsh-prompt-deck', 'data-dsh-part': 'empty' },
            t('noMatch'))
        }
        return h('ul', { className: 'dpd-list', 'data-dsh-plugin': 'dsh-prompt-deck', 'data-dsh-part': 'list' },
          filtered.map((item) =>
            h(CardRow, {
              key: item.id,
              item,
              disabled: busy,
              onInject: inject,
              onEdit: startEdit,
              onDelete: deleteItem,
            })))
      }

      return h('div', {
        className: 'dpd-side',
        'data-dsh-plugin': 'dsh-prompt-deck',
        'data-dsh-surface': 'sidebar',
        'data-dsh-part': 'side',
      },
        h('div', { className: 'dpd-head' },
          h('input', {
            className: 'dpd-search',
            ref: searchRef,
            value: query,
            placeholder: t('search'),
            'aria-label': t('search'),
            'data-dsh-plugin': 'dsh-prompt-deck',
            'data-dsh-part': 'search',
            disabled: !!editor,
            onChange: (e) => setQuery(e.target.value),
            onKeyDown: onSearchKey,
          }),
          h('button', {
            className: 'dpd-btn dpd-btn-primary',
            disabled: busy,
            onClick: () => (editor ? closeEditor() : startCreate()),
          }, editor ? t('cancel') : t('newBtn')),
        ),
        error
          ? h('div', { className: 'dpd-error', 'data-dsh-plugin': 'dsh-prompt-deck', 'data-dsh-part': 'error' },
              h('span', null, error),
              h('button', { className: 'dpd-btn', disabled: busy, onClick: () => load(items === null) }, t('retry')),
            )
          : null,
        h('div', { className: 'dpd-body' }, body()),
        !editor && items && items.length > 0
          ? h('div', { className: 'dpd-foot' }, t('foot'))
          : null,
      )
    }

    // ── the composer-side launcher button ───────────────────────────────
    function DeckButton() {
      const openDeck = () => {
        try {
          sidebarRight.openTab(TAB_KIND) // focuses the existing tab when open
        } catch (e) {
          console.error('[dsh-prompt-deck] openTab failed:', e)
        }
      }
      return h('div', {
        className: 'dpd-wrap',
        'data-dsh-plugin': 'dsh-prompt-deck',
        'data-dsh-surface': 'composer',
      },
        h('button', {
          className: 'dpd-trigger',
          'data-dsh-plugin': 'dsh-prompt-deck',
          'data-dsh-part': 'trigger',
          onClick: openDeck,
        }, t('btn')),
      )
    }

    // ── activation ──────────────────────────────────────────────────────
    return {
      inject: ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight'],
      apply(ctx) {
        try {
          ensureStyle()
          ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-prompt-deck: dicts')
          setT(ctx.locale.bind(NS))
          sidebarRight = ctx.sidebarRight

          // Tab type: a page opened by kind, discoverable from the guide page.
          ctx.effect(() => ctx.sidebarRightTabs.register({
            id: TAB_ID,
            kind: TAB_KIND,
            title: () => t('nav'),
            guide: [{
              id: 'deck',
              order: 70,
              title: () => t('nav'),
              description: () => t('guideDesc'),
            }],
          }), 'dsh-prompt-deck: tab type')

          // Tab body: the deck panel, keyed by the definition's id.
          ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
            { name: 'sidebar.right.pane.tab', key: TAB_ID, locale: NS },
            DeckPanel,
          )), 'dsh-prompt-deck: tab body')

          // Launcher beside the input box (session scope, additive order).
          ctx.effect(() => ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
            {
              name: 'conversation.input.left',
              id: 'dsh-prompt-deck',
              order: 70,
              label: () => t('nav'),
              locale: NS,
            },
            DeckButton,
          )), 'dsh-prompt-deck: launcher')
        } catch (e) {
          console.error('[dsh-prompt-deck] apply failed:', e)
        }
      },
    }
  },
})
