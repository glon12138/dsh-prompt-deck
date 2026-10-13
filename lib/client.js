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
      deckTab: '卡组',
      trashTab: '回收站',
      restore: '恢复',
      purge: '永久删除',
      purgeConfirm: '永久删除这张卡片？无法恢复。',
      purgeYes: '永久删除',
      trashEmpty: '回收站是空的',
      restoreError: '恢复失败',
      tagsPh: '标签（逗号分隔）',
      groupPh: '分组（可选）',
      groupAll: '全部分组',
      exportBtn: '导出',
      importBtn: '导入',
      exportError: '导出失败',
      importError: '导入失败',
      importBadJson: '文件不是合法 JSON',
      importBadShape: '找不到提示词列表（需要数组或 prompts 数组）',
      importDone: '导入完成',
      importSkipped: '跳过',
      importInvalid: '无效',
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
      deckTab: 'Deck',
      trashTab: 'Trash',
      restore: 'Restore',
      purge: 'Delete forever',
      purgeConfirm: 'Delete this card forever? This cannot be undone.',
      purgeYes: 'Delete forever',
      trashEmpty: 'Trash is empty',
      restoreError: 'Restore failed',
      tagsPh: 'Tags (comma-separated)',
      groupPh: 'Group (optional)',
      groupAll: 'All groups',
      exportBtn: 'Export',
      importBtn: 'Import',
      exportError: 'Export failed',
      importError: 'Import failed',
      importBadJson: 'File is not valid JSON',
      importBadShape: 'No prompts list found (need an array or a prompts array)',
      importDone: 'Import done',
      importSkipped: 'skipped',
      importInvalid: 'invalid',
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
    // Light values below are literal fallbacks only; on any DSH host the
    // --dsw-alias-* tokens resolve on <body> and flip with
    // body[data-ds-dark-theme], so light/dark both come free.
    const CSS = `
.dpd-wrap { position: relative; display: inline-flex; }
.dpd-trigger { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 10px;
  border: none; border-radius: 6px; font-size: 12px; line-height: 1; cursor: pointer;
  color: var(--dsw-alias-label-primary, #0f1115);
  background: var(--dsw-alias-button-tool-bar-fill, rgba(38,49,72,0.06)); }
.dpd-trigger:hover {
  background: var(--dsw-alias-button-tool-bar-hover, rgba(38,49,72,0.10)); }
.dpd-side { display: flex; flex-direction: column; gap: 10px; box-sizing: border-box;
  width: 100%; height: 100%; min-height: 0; padding: 12px; text-align: left;
  color: var(--dsw-alias-label-primary, #0f1115); }
.dpd-head { display: flex; gap: 8px; align-items: center; }
.dpd-search { flex: 1; min-width: 0; height: 30px; padding: 0 10px; font-size: 12.5px;
  color: var(--dsw-alias-label-primary, #0f1115);
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.10)); border-radius: 6px; outline: none; }
.dpd-search::placeholder { color: var(--dsw-alias-label-tertiary, #81858c); }
.dpd-search:focus { border-color: var(--dsw-alias-link, #4176e6); }
.dpd-search:disabled { opacity: 0.6; }
/* Secondary button — soft gray fill; token flips with the theme. */
.dpd-btn { display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  height: 28px; padding: 0 12px; font-size: 12.5px; border: none; border-radius: 6px;
  cursor: pointer; color: var(--dsw-alias-label-primary, #0f1115);
  background: var(--dsw-alias-button-primary-dimmed, #ebeef2); }
.dpd-btn:hover { background: var(--dsw-alias-interactive-bg-active, rgba(38,49,72,0.10)); }
.dpd-btn:disabled { opacity: 0.55; cursor: default; }
/* Primary — DSH main button: dark fill + light text, flips with the theme. */
.dpd-btn-primary { color: var(--dsw-alias-label-primary-inverted, #ffffff);
  background: var(--dsw-alias-button-primary-fill, #0f1115); }
.dpd-btn-primary:hover { background: var(--dsw-alias-button-primary-hover, #43454a); }
.dpd-btn-danger { color: var(--dsw-alias-state-error-primary, #ec1313); background: transparent; }
.dpd-btn-danger:hover { background: var(--dsw-alias-interactive-bg-hover-danger, rgba(236,19,19,0.05)); }
.dpd-body { flex: 1; min-height: 0; overflow: auto; }
.dpd-hint { padding: 20px 12px; font-size: 12.5px; line-height: 1.6; text-align: center;
  color: var(--dsw-alias-label-secondary, #61666b); }
.dpd-error { display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 8px 10px; font-size: 12px; border-radius: 6px;
  color: var(--dsw-alias-state-error-primary, #ec1313);
  background: var(--dsw-alias-state-error-secondary, rgba(242,90,90,0.10));
  border: 1px solid var(--dsw-alias-state-error-primary, #ec1313); }
.dpd-error .dpd-btn { height: 24px; padding: 0 8px; font-size: 12px; color: var(--dsw-alias-state-error-primary, #ec1313); background: transparent; }
/* Borderless tabs: text only; active = bold + 2px brand underline. */
.dpd-tabs { display: flex; align-items: center; gap: 2px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.04)); }
.dpd-tab { flex: none; height: 30px; padding: 0 10px; font-size: 12.5px; cursor: pointer;
  background: transparent; border: none; border-bottom: 2px solid transparent;
  margin-bottom: -1px; border-radius: 0;
  color: var(--dsw-alias-label-tertiary, #81858c); }
.dpd-tab:hover { color: var(--dsw-alias-label-primary, #0f1115); }
.dpd-tab-active { color: var(--dsw-alias-label-primary, #0f1115); font-weight: 600;
  border-bottom-color: var(--dsw-alias-button-primary-fill, #0f1115); }
.dpd-io { margin-left: auto; padding: 0 10px; font-size: 12px; }
.dpd-io + .dpd-io { margin-left: 0; }
.dpd-file { display: none; }
/* Compact list: hairline separators, hover reveals the line-icon actions. */
.dpd-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.dpd-item { display: flex; flex-direction: column; border-radius: 6px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.05)); }
.dpd-item:last-child { border-bottom: none; }
.dpd-item:hover, .dpd-item:focus-within {
  background: var(--dsw-alias-interactive-bg-hover, rgba(38,49,72,0.06)); }
.dpd-item-row { display: flex; align-items: center; gap: 2px; }
.dpd-preview { display: flex; flex-direction: column; gap: 6px; padding: 2px 8px 8px 32px; }
.dpd-preview-text { max-height: 260px; overflow: auto; white-space: pre-wrap; word-break: break-word;
  padding: 8px 10px; font-size: 12.5px; line-height: 1.6;
  color: var(--dsw-alias-label-primary, #0f1115);
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.04)); border-radius: 6px; }
.dpd-preview-ops { display: flex; justify-content: flex-end; }
.dpd-item-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;
  padding: 8px; border: none; border-radius: 6px; background: transparent;
  cursor: pointer; text-align: left; color: inherit; }
.dpd-item-title { font-size: 12.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  color: var(--dsw-alias-label-primary, #0f1115); }
.dpd-item-preview { font-size: 11.5px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  color: var(--dsw-alias-label-secondary, #61666b); }
.dpd-item-op { width: 26px; height: 26px; flex: none; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; border-radius: 6px; background: transparent; cursor: pointer;
  color: var(--dsw-alias-label-tertiary, #81858c);
  opacity: 0; transition: opacity 0.12s ease; }
.dpd-item:hover .dpd-item-op, .dpd-item:focus-within .dpd-item-op { opacity: 1; }
.dpd-item-toggle { opacity: 1; }
.dpd-item-op:hover { color: var(--dsw-alias-label-primary, #0f1115);
  background: var(--dsw-alias-interactive-bg-hover-solid, #f1f3f5); }
.dpd-item-op.dpd-op-danger:hover { color: var(--dsw-alias-state-error-primary, #ec1313);
  background: var(--dsw-alias-interactive-bg-hover-danger, rgba(236,19,19,0.05)); }
.dpd-item-op:disabled { opacity: 0.5; cursor: default; }
.dpd-ico { flex: none; display: block; }
.dpd-confirm { flex: 1; display: flex; align-items: center; justify-content: flex-end; gap: 6px;
  padding: 6px 8px; font-size: 12px; color: var(--dsw-alias-state-error-primary, #ec1313); }
.dpd-confirm .dpd-btn { height: 24px; padding: 0 8px; font-size: 12px; }
.dpd-editor { display: flex; flex-direction: column; gap: 8px; padding: 4px 0; }
.dpd-input, .dpd-textarea { width: 100%; box-sizing: border-box; padding: 7px 9px; font-size: 12.5px;
  font-family: inherit; color: var(--dsw-alias-label-primary, #0f1115);
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.10)); border-radius: 6px; outline: none; }
.dpd-input::placeholder, .dpd-textarea::placeholder { color: var(--dsw-alias-label-tertiary, #81858c); }
.dpd-textarea { min-height: 112px; resize: vertical; line-height: 1.5; }
.dpd-input:focus, .dpd-textarea:focus { border-color: var(--dsw-alias-link, #4176e6); }
.dpd-editor-error { font-size: 12px; color: var(--dsw-alias-state-error-primary, #ec1313); }
.dpd-editor-ops { display: flex; justify-content: flex-end; gap: 8px; }
.dpd-foot { padding-top: 6px; font-size: 11px; line-height: 1.5; text-align: center;
  color: var(--dsw-alias-label-tertiary, #81858c); border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.04)); }
.dpd-filters { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.dpd-chip { height: 22px; padding: 0 9px; font-size: 11px; border-radius: 11px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.10));
  color: var(--dsw-alias-label-secondary, #61666b);
  background: transparent; }
.dpd-chip:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38,49,72,0.06)); }
.dpd-chip-active { color: var(--dsw-alias-label-primary, #0f1115); font-weight: 500;
  border-color: transparent;
  background: var(--dsw-alias-interactive-bg-active, rgba(38,49,72,0.10)); }
.dpd-select { height: 24px; margin-left: auto; font-size: 11px; border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.10));
  color: var(--dsw-alias-label-primary, #0f1115);
  background: var(--dsw-alias-bg-layer-1, #ffffff); outline: none; }
.dpd-item-tags { font-size: 10.5px;
  color: var(--dsw-alias-label-tertiary, #81858c); }
.dpd-notice { display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 8px 10px; font-size: 12px; border-radius: 6px;
  color: var(--dsw-alias-label-primary, #0f1115);
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.04)); }
.dpd-notice .dpd-btn { height: 24px; padding: 0 8px; font-size: 12px; }
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
      restore: (id) => call('/restore', { id }),
      purge: (id) => call('/purge', { id }),
      export: () => call('/export'),
      import: (prompts) => call('/import', { prompts }),
    }

    const firstLine = (s) => {
      const line = String(s || '').split('\n')[0]
      return line.length > 120 ? line.slice(0, 120) + '…' : line
    }

    // ── thin line icons (Lucide paths, stroke = currentColor) ──────────
    const ico = (paths) => h('svg', {
      className: 'dpd-ico',
      width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
      'aria-hidden': 'true', focusable: 'false',
    }, ...paths.map((d, i) => h('path', { key: i, d })))
    const IcoPencil = () => ico([
      'M12 20h9',
      'M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z',
    ])
    const IcoTrash = () => ico([
      'M3 6h18',
      'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
      'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6',
      'M10 11v6',
      'M14 11v6',
    ])
    const IcoRestore = () => ico([
      'M3 2v6h6',
      'M3.51 15a9 9 0 1 0 2.13-9.36L3 8',
    ])
    const IcoDownload = () => ico([
      'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4',
      'M7 10l5 5 5-5',
      'M12 15V3',
    ])
    const IcoUpload = () => ico([
      'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4',
      'M17 8l-5-5-5 5',
      'M12 3v12',
    ])

    // ── one row of the list: inject target + edit/delete ops ────────────
    function CardRow({ item, view, disabled, onInject, onEdit, onDelete, onRestore, onPurge }) {
      const [confirming, setConfirming] = useState(false)
      const [expanded, setExpanded] = useState(false) // inline full-content view
      const showPreview = expanded && !confirming
      const appendAndCollapse = () => { onInject(item); setExpanded(false) }
      return h('li', { className: 'dpd-item', 'data-dsh-plugin': 'dsh-prompt-deck', 'data-dsh-part': 'item' },
        h('div', { className: 'dpd-item-row' },
          confirming
            ? h('div', { className: 'dpd-confirm' },
                h('span', null, view === 'trash' ? t('purgeConfirm') : t('delConfirm')),
                h('button', {
                  className: 'dpd-btn dpd-btn-danger',
                  disabled,
                  onClick: async () => {
                    const done = await (view === 'trash' ? onPurge(item) : onDelete(item))
                    if (!done) setConfirming(false) // failed → back out, banner shows why
                  },
                }, view === 'trash' ? t('purgeYes') : t('yes')),
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
                  onClick: () => {
                    if (view === 'trash') setExpanded((v) => !v)
                    else if (onInject) onInject(item)
                  },
                },
                  h('span', { className: 'dpd-item-title' }, item.title),
                  h('span', { className: 'dpd-item-preview' }, firstLine(item.content)),
                ),
                view === 'trash'
                  ? h(React.Fragment, null,
                      h('button', {
                        className: 'dpd-item-op',
                        title: t('restore'),
                        disabled,
                        onClick: () => void onRestore(item),
                      }, h(IcoRestore)),
                      h('button', {
                        className: 'dpd-item-op dpd-op-danger',
                        title: t('purge'),
                        disabled,
                        onClick: () => setConfirming(true),
                      }, h(IcoTrash)),
                    )
                  : h(React.Fragment, null,
                      h('button', {
                        className: 'dpd-item-op',
                        title: t('edit'),
                        disabled,
                        onClick: () => onEdit(item),
                      }, h(IcoPencil)),
                      h('button', {
                        className: 'dpd-item-op dpd-op-danger',
                        title: t('del'),
                        disabled,
                        onClick: () => setConfirming(true),
                      }, h(IcoTrash)),
                    ),
              ),
        ),
        showPreview
          ? h('div', { className: 'dpd-preview', 'data-dsh-plugin': 'dsh-prompt-deck', 'data-dsh-part': 'preview' },
              h('div', { className: 'dpd-preview-text' }, item.content),
              (item.tags || []).length > 0 || item.group
                ? h('div', { className: 'dpd-item-tags' },
                    [item.group, ...(item.tags || [])].filter(Boolean).join(' · '))
                : null,
              view === 'deck'
                ? h('div', { className: 'dpd-preview-ops' },
                    h('button', { className: 'dpd-btn dpd-btn-primary', disabled, onClick: appendAndCollapse }, t('append')),
                  )
                : null,
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
      const [view, setView] = useState('deck') // 'deck' | 'trash'
      const [activeTag, setActiveTag] = useState(null)   // null = 全部
      const [activeGroup, setActiveGroup] = useState('') // '' = 全部
      const [error, setError] = useState(null) // panel-level (load / refresh / delete)
      const [editor, setEditor] = useState(null) // null | { id, title, content }
      const [editorError, setEditorError] = useState(null)
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState(null) // transient success banner
      const fileRef = useRef(null)

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

      const startCreate = () => { setEditor({ id: null, title: '', content: '', tags: '', group: '' }); setEditorError(null) }
      const startEdit = (item) => {
        setEditor({
          id: item.id,
          title: item.title,
          content: item.content,
          tags: (item.tags || []).join(', '),
          group: item.group || '',
        })
        setEditorError(null)
      }
      const closeEditor = () => { setEditor(null); setEditorError(null) }

      const submitEditor = async () => {
        if (!editor) return
        const title = editor.title.trim()
        const content = editor.content.trim()
        if (!title || !content) { setEditorError(t('required')); return }
        setBusy(true)
        try {
          const tags = editor.tags.split(',').map((s) => s.trim()).filter(Boolean)
          const payload = { title, content, tags, group: editor.group.trim() }
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

      const deckItems = useMemo(() => (items || []).filter((p) => !p.deletedAt), [items])
      const trashItems = useMemo(() => (items || []).filter((p) => p.deletedAt), [items])
      const allTags = useMemo(() => {
        const s = new Set()
        deckItems.forEach((p) => (p.tags || []).forEach((x) => s.add(x)))
        return [...s].sort()
      }, [deckItems])
      const allGroups = useMemo(() => {
        const s = new Set()
        deckItems.forEach((p) => { if (p.group) s.add(p.group) })
        return [...s].sort()
      }, [deckItems])
      // 所选标签被删/改后自动失效，避免卡在空结果
      const effectiveTag = activeTag && allTags.includes(activeTag) ? activeTag : null
      const effectiveGroup = activeGroup && allGroups.includes(activeGroup) ? activeGroup : ''
      const restoreItem = async (item) => {
        setBusy(true)
        try {
          await api.restore(item.id)
          setError(null)
          await load(false)
          return true
        } catch (e) {
          setError(`${t('restoreError')}: ${e.message}`)
          return false
        } finally {
          setBusy(false)
        }
      }

      const purgeItem = async (item) => {
        setBusy(true)
        try {
          await api.purge(item.id)
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

      const exportDeck = async () => {
        setBusy(true)
        try {
          const data = await api.export()
          const { ok: _ok, ...payload } = data // strip the HTTP envelope
          const blob = new Blob([JSON.stringify(payload, null, 2) + '\n'], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `prompt-deck-${new Date().toISOString().slice(0, 10)}.json`
          document.body.appendChild(a)
          a.click()
          a.remove()
          setTimeout(() => URL.revokeObjectURL(url), 1000)
          setError(null)
          setNotice(null)
        } catch (e) {
          setError(`${t('exportError')}: ${e.message}`)
        } finally {
          setBusy(false)
        }
      }

      const importDeck = async (e) => {
        const file = e.target.files && e.target.files[0]
        e.target.value = '' // allow re-picking the same file
        if (!file) return
        setBusy(true)
        try {
          const text = await file.text()
          let parsed
          try {
            parsed = JSON.parse(text)
          } catch {
            throw new Error(t('importBadJson'))
          }
          const list = Array.isArray(parsed)
            ? parsed
            : parsed && Array.isArray(parsed.prompts)
              ? parsed.prompts
              : null
          if (!list) throw new Error(t('importBadShape'))
          const res = await api.import(list)
          const parts = [`+${res.added}`]
          if (res.skipped) parts.push(`${t('importSkipped')} ${res.skipped}`)
          if (res.invalid) parts.push(`${t('importInvalid')} ${res.invalid}`)
          setNotice(`${t('importDone')}: ${parts.join(' · ')}`)
          setError(null)
          await load(false)
        } catch (err) {
          setNotice(null)
          setError(`${t('importError')}: ${err.message}`)
        } finally {
          setBusy(false)
        }
      }

      const filtered = useMemo(() => {
        const base = view === 'trash' ? trashItems : deckItems
        const q = query.trim().toLowerCase()
        let out = q
          ? base.filter((p) => p.title.toLowerCase().includes(q) || String(p.content).toLowerCase().includes(q))
          : base
        if (view === 'deck') {
          if (effectiveTag) out = out.filter((p) => (p.tags || []).includes(effectiveTag))
          if (effectiveGroup) out = out.filter((p) => p.group === effectiveGroup)
        }
        return out
      }, [view, deckItems, trashItems, query, effectiveTag, effectiveGroup])

      const onSearchKey = (e) => {
        if (e.key === 'Enter' && !editor && view === 'deck' && filtered.length > 0) inject(filtered[0])
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
            h('input', {
              className: 'dpd-input',
              value: editor.tags,
              placeholder: t('tagsPh'),
              'aria-label': t('tagsPh'),
              onChange: (e) => setEditor({ ...editor, tags: e.target.value }),
            }),
            h('input', {
              className: 'dpd-input',
              value: editor.group,
              placeholder: t('groupPh'),
              'aria-label': t('groupPh'),
              maxLength: 50,
              onChange: (e) => setEditor({ ...editor, group: e.target.value }),
            }),
            editorError ? h('div', { className: 'dpd-editor-error' }, editorError) : null,
            h('div', { className: 'dpd-editor-ops' },
              h('button', { className: 'dpd-btn', disabled: busy, onClick: closeEditor }, t('cancel')),
              h('button', { className: 'dpd-btn dpd-btn-primary', disabled: busy, onClick: submitEditor }, t('save')),
            ),
          )
        }
        if (!items) return h('div', { className: 'dpd-hint' }, t('loading'))
        const base = view === 'trash' ? trashItems : deckItems
        if (base.length === 0) {
          return h('div', { className: 'dpd-hint', 'data-dsh-plugin': 'dsh-prompt-deck', 'data-dsh-part': 'empty' },
            view === 'trash' ? t('trashEmpty') : t('empty'))
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
              view,
              disabled: busy,
              onInject: view === 'deck' ? inject : undefined,
              onEdit: startEdit,
              onDelete: deleteItem,
              onRestore: restoreItem,
              onPurge: purgeItem,
            })))
      }

      return h('div', {
        className: 'dpd-side',
        'data-dsh-plugin': 'dsh-prompt-deck',
        'data-dsh-surface': 'sidebar',
        'data-dsh-part': 'side',
      },
        h('input', {
          type: 'file',
          accept: '.json,application/json',
          ref: fileRef,
          className: 'dpd-file',
          'data-dsh-plugin': 'dsh-prompt-deck',
          'data-dsh-part': 'import-file',
          onChange: importDeck,
        }),
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
        h('div', { className: 'dpd-tabs', 'data-dsh-plugin': 'dsh-prompt-deck', 'data-dsh-part': 'tabs' },
          h('button', {
            className: view === 'deck' ? 'dpd-tab dpd-tab-active' : 'dpd-tab',
            'aria-pressed': view === 'deck',
            onClick: () => { setView('deck'); setActiveTag(null); setActiveGroup('') },
          }, `${t('deckTab')} (${deckItems.length})`),
          h('button', {
            className: view === 'trash' ? 'dpd-tab dpd-tab-active' : 'dpd-tab',
            'aria-pressed': view === 'trash',
            onClick: () => { setView('trash'); setActiveTag(null); setActiveGroup('') },
          }, `${t('trashTab')} (${trashItems.length})`),
          h('button', {
            className: 'dpd-btn dpd-io',
            disabled: busy || !items,
            title: t('exportBtn'),
            onClick: exportDeck,
          }, h(IcoDownload), t('exportBtn')),
          h('button', {
            className: 'dpd-btn dpd-io',
            disabled: busy || !!editor,
            title: t('importBtn'),
            onClick: () => fileRef.current && fileRef.current.click(),
          }, h(IcoUpload), t('importBtn')),
        ),
        view === 'deck' && (allTags.length > 0 || allGroups.length > 0)
          ? h('div', { className: 'dpd-filters', 'data-dsh-plugin': 'dsh-prompt-deck', 'data-dsh-part': 'filters' },
              ...allTags.map((tag) =>
                h('button', {
                  key: tag,
                  className: tag === effectiveTag ? 'dpd-chip dpd-chip-active' : 'dpd-chip',
                  'aria-pressed': tag === effectiveTag,
                  onClick: () => setActiveTag(tag === effectiveTag ? null : tag),
                }, tag)),
              allGroups.length > 0
                ? h('select', {
                    className: 'dpd-select',
                    value: effectiveGroup,
                    'aria-label': t('groupAll'),
                    onChange: (e) => setActiveGroup(e.target.value),
                  },
                    h('option', { value: '' }, t('groupAll')),
                    ...allGroups.map((g) => h('option', { key: g, value: g }, g)))
                : null,
            )
          : null,
        error
          ? h('div', { className: 'dpd-error', 'data-dsh-plugin': 'dsh-prompt-deck', 'data-dsh-part': 'error' },
              h('span', null, error),
              h('button', { className: 'dpd-btn', disabled: busy, onClick: () => load(items === null) }, t('retry')),
            )
          : null,
        notice
          ? h('div', { className: 'dpd-notice', 'data-dsh-plugin': 'dsh-prompt-deck', 'data-dsh-part': 'notice' },
              h('span', null, notice),
              h('button', { className: 'dpd-btn', disabled: busy, onClick: () => setNotice(null) }, '✕'),
            )
          : null,
        h('div', { className: 'dpd-body' }, body()),
        !editor && view === 'deck' && deckItems && deckItems.length > 0
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
