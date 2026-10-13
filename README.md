# dsh-prompt-deck

> 提示词卡组 — a local prompt deck for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness).
> 本地提示词管理插件：搜索、查看、新建、编辑、删除提示词卡片，一键追加到输入框。

A **dual-half DSH plugin**: a button beside the composer opens the deck in the right
Sidebar; clicking a card **appends** its content to the input draft — it never
overwrites what you already typed.

输入框旁的「提示词」按钮 → 右侧面板打开卡组 tab；点击卡片**追加**注入输入框，
不覆盖已有草稿。数据全部存在本地 `~/.dsh/prompt-deck.json`。

## Features / 功能

- **右侧面板 tab**（`sidebar.right.pane.tab`，会话级）——搜索、列表、新建、编辑、删除（二次确认）
- **行内展开看全文** —— 卡片左侧 ▸ 原地展开完整内容，可直接「追加到输入框」
- **点击卡片注入** —— 追加到当前草稿，保留已有输入；搜索框回车注入首个匹配
- **引导页入口** —— 右侧栏「新标签页」的 guide 页有直达入口卡片
- **首次运行种子数据** —— 文件不存在时写入 4 张示例卡；只播一次，删除不回种
- **错误处理** —— 加载/保存/删除失败显示横幅与「重试」，损坏的存储文件报 500 而不静默覆盖

## Structure / 结构

```
src/index.ts      HOST half  — /__prompt-deck/{list,save,delete} routes + JSON storage (tsc → dist/)
lib/client.js     BROWSER half — composer button + right-Sidebar tab body (loaded via exports["./client"])
cordis.patch.yml  bundle layer — inserts the host row into a profile
debug.patch.yml   dev overlay — pnpm dev boots with the local src/index.ts
```

Mounting seams / 挂载缝隙:

| Seam | Kind | Role |
|---|---|---|
| `conversation.input.left` | list, session | launcher button beside the composer |
| `sidebar.right.pane.tab` | keyed, session | the deck body inside the right Sidebar tab |
| `ctx.sidebarRightTabs` | tab type registry | `kind: 'prompt-deck'` + guide entry |
| `ctx.webServer` | host routes | JSON API under `/__prompt-deck/` |

双半通讯：浏览器半 `fetch('/__prompt-deck/...')` → 宿主半路由 → `~/.dsh/prompt-deck.json`。

## Quick start / 快速开始

```sh
pnpm install
pnpm run build          # tsc → dist/index.js

# Boot the web profile with the local source overlay:
pnpm dev                # = dsh web --patch ./debug.patch.yml
```

Or install the built plugin into a profile (run from the plugin's **parent** directory —
`dsh plugin add <dir>` anchors relative paths to the invoking directory):

```sh
dsh plugin --profile my-profile add ./dsh-prompt-deck
dsh --profile my-profile
```

> `pnpm dev` 的 `--patch`（launcher 参数）必须放在 app 参数（如 `--no-open`）之前，否则报 `unknown option`。

## Verify / 验证

```sh
curl http://127.0.0.1:3080/dsh-prompt-deck/ping    # 200 {"ok":true,...}
curl http://127.0.0.1:3080/__prompt-deck/list      # 200 {"ok":true,"prompts":[...]}
```

In the UI: type something into the composer → click **提示词** → search → click a card →
the content is appended below your draft.

- 改 `lib/client.js`（浏览器半）：刷新页面即生效。
- 改 `src/index.ts`（宿主半）：需要重启服务（不热重载）。

## HTTP routes / 宿主路由

| Route | Method | Body | Result |
|---|---|---|---|
| `/__prompt-deck/list` | GET | — | `{ ok, prompts }`；文件缺失时用种子数据初始化 |
| `/__prompt-deck/save` | POST | `{ id?, title, content }` | upsert one card → `{ ok, prompt }` |
| `/__prompt-deck/delete` | POST | `{ id }` | → `{ ok, id }` |
| `/dsh-prompt-deck/ping` | GET | — | health check |

Storage guarantees: every read-modify-write runs through one promise chain
(no interleaved writes), writes land via tmp-file + rename (a crash never leaves a
half-written store), and a corrupted file fails loudly (500) instead of being
overwritten.

## Theme & Skin Compatibility / 主题与皮肤兼容

This plugin follows the DSH Web styling contract
([`docs/web-styling.md`](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/web-styling.md)):
all colors come from `--dsw-alias-*` design tokens (literals only as fallbacks), with no
per-theme CSS selectors. It also implements the
[dsh-web Skin Center compatibility contract](https://github.com/zhu1090093659/dsh-web/tree/main/packages/skins/skin-center/contracts)
**L1 (token coverage)** + **L2 (semantic attributes `data-dsh-plugin` / `data-dsh-part` / `data-dsh-surface`)**.

本插件遵循 DSH Web 样式契约：全部颜色经 `--dsw-alias-*` 设计令牌引用（字面量仅作兜底），
无按主题分支的 CSS 选择器；并实现 dsh-web 皮肤中心兼容契约 L1（令牌覆盖）+ L2（语义属性）。

> 注意：`data-dsh-plugin` 是 dsh-web 维护的闭合枚举——发布前到
> [dsh-web issues](https://github.com/zhu1090093659/dsh-web/issues) 注册你的插件 id，否则下游皮肤匹配不到。

## Pitfalls / 坑

1. 浏览器半必须用 `window.__ModuleLoader__.load({ factory: (require) => ... })`，
   用 `require('react')` 等取依赖，不要写裸 ESM import（加载器只认 factory 形态）。
2. `exports["./client"]` 必须指向浏览器半文件，加载器靠它发现 client bundle。
3. Session 级插槽的标准 props（`useInput` / `inputActions`）由框架自动下发——
   右面板 tab 体也能直接 `setDraft` 注入，不需要自己桥接。
4. 版本线对齐：所有 `@deepseek-ai/dsh-*` 包保持同一版本线（当前 `0.2.0-rc.2`），
   避免 pnpm 装两份模块。
5. `@deepseek-ai/cordis` 是 peerDependency：只 `import type { Context }`（编译期擦除），
   运行时 ctx 由宿主传入。
6. Pure ESM：package.json 须 `"type": "module"`；tsc 用 `module: esnext` +
   `moduleResolution: bundler` 保留 bare specifier。
7. 注册是 effect：`ctx.slots.register()` / `ctx.on()` 卸载自动清理；自己申请的资源
   （定时器/连接）要包 `ctx.effect(() => { ...; return cleanup })`。
8. 加载顺序靠服务依赖（`export const inject = [...]`），不靠文件顺序。
9. `dsh plugin add <dir>` 的相对路径锚定「调用目录」——在插件父目录执行。
10. Node 版本：DSH 要求 `^22.19.0 || >=24.0.0`。

# 发布命令
npm publish --registry=https://registry.npmjs.org/