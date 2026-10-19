# dsh-turn-diff

A read-only **per-turn diff page** for the DeepSeek Harness web GUI: review what
one turn changed, grouped by file, in the right Sidebar.

It answers the question the conversation itself only answers piecemeal — the
`write` / `edit` tool rows each carry their own hunks, but nothing aggregates a
turn.

## What it looks like

- **Entry**: a `本轮 diff +N −M` button in the completed turn's action strip
  (next to Like/Dislike and the timing pills). The `assistant-actions` strip
  renders under a turn's closing assistant only, so it is one button per turn.
  The latest turn's actions are always visible; older turns reveal them on hover.
- **Surface**: a page tab in the right Sidebar, titled `本轮 diff`, listing one
  section per changed file with that file's hunks and `+N −M`, drawn with the
  shipped `DiffBlock` primitive — the same renderer the tool rows use.
- **Sections collapse.** Each file header is the toggle — chevron, path, and
  `+N −M · k 处` — and every section starts collapsed, so a many-file turn opens
  as a scannable list rather than a wall of hunks. A turn that changed exactly
  one file opens it, since one click to reveal the only section would be pure
  ceremony. A `全部展开 / 全部收起` control in the header flips them together;
  opening another turn remounts the page and starts collapsed again. A single
  file's body is capped at 400 lines, so a huge `write` folds its middle behind
  the shipped expand control instead of mounting thousands of rows.
- It is also reachable from the right Sidebar's guide entries; opened that way
  (no selection carried over) it explains how to open it from the conversation.

## Data source

Nothing is re-read from disk and no baseline is needed. Every settled
`write` / `edit` / `str_replace_editor` result already carries its applied hunks
(±3 context lines) in `tool/result` metadata (`meta.diffs`), which the session
log persists and the Chat snapshot projects to the browser. The plugin walks the
turn's tool nodes, groups those hunks by `path`, and renders them.

When a result carries no usable metadata — a replayed window that dropped it, or
an executor that never attached any — the hunk is derived from the call's own
arguments instead (coarser: `write` becomes a whole-file addition, `edit` a
single old/new pair). Failed calls and dispatcher parents contribute nothing,
matching the produced-files row's rules; a dispatcher's children are folded in.

**This is not a full line-by-line file diff.** Hunks carry context, not the
whole file, so long unchanged stretches between changes are absent. A true
full-file diff needs a baseline (git HEAD or a session snapshot), which this
plugin deliberately does not have.

## The conversation window

The browser holds only the tail of a session: the Chat target opens on the last
`PAGE_MESSAGES` (50) user/assistant messages, plus each counted message's source
group. A long turn can therefore start *before* the loaded window — in the
session this behaviour was diagnosed against, turn 14 began at seq 559 while the
window began at seq 645, so the `write` that created its headline file (seq 617)
was never in the client. Nothing can be aggregated for events the browser never
received, and the shipped tool rows cannot show them either.

So the entry button tops the window up before aggregating: it resolves the
Session object through `ctx.sessions`, pages history back until the window covers
the turn's own start (`loadThrough`, falling back to repeated `loadOlder`), waits
for the projection to settle, and only then reports. The button reads
`正在载入本轮…` while that runs. If history still leaves a result with no
readable call head and no metadata, the page says how many changes could not be
resolved and points at scrolling the conversation up.

One consequence is worth stating plainly: a turn that reaches back past the
window has an aggregate that is only a *lower bound*, so the entry button shows
no line counts for it — just `本轮 diff …`, with the reason in its tooltip.
Advertising the short number would contradict the page one click later. The
button's counts appear once the turn is fully loaded, which the top-up does on
first open, and from then on they match the page exactly.

## Install

The plugin must be reachable from an enabled Loader entry. The client module
system accepts a **path-like** row name: it resolves the module and then walks up
to the nearest `package.json` to read this package's `dsh.client` manifest and
its `./client` bundle. So the package can live anywhere, including outside the
profile.

Add exactly **one** row to the patch file of **each surface you use** — the CLI's
`web` profile and the Desktop app keep separate profiles with separate patch
files:

| Surface | Patch file | Web UI |
| --- | --- | --- |
| `dsh web` | `~/.dsh/profiles/web/cordis.patch.yml` | the port `dsh web` prints |
| DSH Desktop | `~/.dsh/profiles/desktop/cordis.patch.yml` | its own loopback port |

```yaml
# <that profile's> cordis.patch.yml
- insert:
    - id: ui-turn-diff
      name: 'file:///G:/workspace/ai-gen/dsh-plugins/dsh-turn-diff/lib/index.js'
```

Then **refresh the page** — no DSH restart. The row joins the composed config and
the modules node half picks the bundle up; the browser needs a reload to fetch
the new boot manifest. Both profiles default to `patchReload: live`, so the row
takes effect in an already-running host; `dsh plugin` is not involved and pnpm is
not required.

Alternatively install the package as a bundle layer (its own `cordis.patch.yml`
inserts the same row by a relative name). Do **not** do both: the two rows share
one id and the Loader refuses a duplicate.

**Uninstall**: delete the row and refresh (or remove the bundle layer).

## Dev loop

Edit `lib/client.js` and refresh the page. The server re-reads the file and
re-hashes the artifact — watch the entry's `rev` change in the boot manifest to
confirm it picked the change up. Plain ESM; no build step.

## Files

| File | Role |
| --- | --- |
| `lib/index.js` | Node half. A no-op: the feature needs no Host service, route, or filesystem access. It exists so the Loader has a row to mount. |
| `lib/client.js` | The whole feature: turn aggregation, the tab type and body, the conversation entry, and the zh/en dictionaries. |
| `cordis.patch.yml` | The bundle-layer install path (see above). |

## Verified against

Two surfaces, whose client builds are **not** the same, and a plugin has to
survive both:

- **`dsh web`** (profile `web`): host `0.1.5-rc.1`, client packages `0.1.5-rc.2`.
- **DSH Desktop** (profile `desktop`): a separate Electron app with its own
  bundled dsh and its own shell build.

What it relies on, stable across both:

- `conversation.chat.assistant-actions` (a `list` slot) — additive, unlike
  `conversation.chat.turnTail`, whose chain renders only its first accepting
  selector (the produced-files row already holds that seat).
- `ctx.sidebarRightTabs` + the keyed `sidebar.right.pane.tab` seat — a page type
  opened by kind, with the selection carried in the tab's navigation params.
- `@deepseek-ai/dsh-client-ui-primitives` — a sealed platform module, so
  `DiffBlock` and `diffTotals` are requirable without an `external` declaration.
  Those two names are stable; **icon names are not** (see below).
- The assistant Chat node's `data.messageId` / `data.turn`, and tool nodes under
  `kind: "tool-call"` carrying `data.root`.
- `ctx.sessions` → `sessionOf` + the Session face's `loadOlder` / `loadThrough`
  (see "The conversation window"). `scope` and `resolveAgentScope` differ by
  build — Desktop has the former only — so both are probed and a missing one
  degrades to "no window top-up" rather than a failure.

### Icon names drift between builds

The two shells ship different icon sets: `dsh web` names them `…Outline14` /
`…Outline16`, while Desktop names them `…OutlineRegular` / `…OutlineMedium`.
Reading a name a build does not have yields `undefined`, and
`createElement(undefined)` throws `Element type is invalid` — which takes the
whole row down, so the entry button silently never appears (this is exactly how
the plugin failed on Desktop the first time). Icon references therefore resolve
from a candidate chain and fall back to a text glyph (`▸` / `▾`) instead of
assuming a name.

## Known limits

- One page per kind: page tabs dedupe within a pane, so opening another turn
  re-navigates the same tab (as intended) rather than stacking.
- The selection is handed to the tab body through an in-memory stash. After a
  page reload a re-opened tab cannot restore it and says so; reopen from the
  conversation.
- The window top-up is best effort. History the Session cannot page back to
  (or an unavailable `ctx.sessions`) leaves the page showing what the window
  holds, with the partial-change notice above it.
- `str_replace_editor` settles through the generic tool row, so its hunks come
  from the argument fallback rather than applied metadata.
