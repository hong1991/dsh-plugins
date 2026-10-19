# dsh-refresh

One-click refresh for the DeepSeek Harness Web GUI. It reloads the page like a
browser refresh — and keeps the current conversation, its scroll position, and
an in-flight reply.

It also carries a second, stronger mode for client-plugin work: **Shift+click**
reloads the client-plugin graph in place, with no page reload at all.

## What it does

| Gesture | What happens | Conversation |
|---|---|---|
| Click the header refresh icon / press **F5** (Desktop) | Full page reload, then the same Session is selected again and the previous scroll position is restored. On Desktop, if a client plugin has been rebuilt since the page booted, the plugin automatically falls back to the in-place hot refresh (see below) | DSH persists the active Session and per-Session drafts; the Host keeps a running turn alive, so the reply continues and the transcript is rebuilt from durable events |
| **Shift+click** | No page reload. The live client-plugin graph is fetched from a small Host route and applied through the module system's own `entries.sync()` | Untouched — React state, scroll, composer, and an in-flight reply all stay exactly where they were |

The control is a 28px icon button in the conversation header's action strip —
the title row at the top of the main panel, beside the right-sidebar opener. It
is deliberately not in the composer dock: that row already carries the Find
control and the composer accessories, and the header strip is the closest
plugin-owned seat to a window/menu bar. The native Electron menu bar itself is
owned by the Desktop process and exposes no client-plugin seat.

The F5 shortcut is registered for Desktop only: browsers reserve F5, so a Web
default would be rejected. Web users can bind `app.refresh` in **Settings →
Shortcuts** if they want a keyboard path there too.

## Why a full refresh does not interrupt the conversation

Three separate mechanisms do the work:

1. **The selected Session is durable.** DSH's Workspace UI persists the active
   Session in `localStorage` under `dsh.sessions.current`; on boot it restores
   that reference before the conversation mounts. The plugin does not replace
   that mechanism — it reads the same row (`retainedBy.mainView`) and relies on
   the shipped restoration.
2. **A turn runs on the Host, not in the page.** Reloading the browser closes
   one follower; the Agent loop keeps running. On reconnect, the session follow
   replays the durable transcript and the active Assistant attempt's compact
   stream, so the reply catches up. Pending approvals and questions are replayed
   by their owning Remote waterfall.
3. **The reading position is restored by this plugin.** The pre-reload snapshot
   stores the Session id and the scrollport's scroll/height pair. After boot the
   plugin waits for that Session to become active, then restores the position
   (distance-ratio for a non-bottom position, pinned to the bottom when the
   reader was at the bottom). It stops at the first wheel, pointer, touch, or
   key input, and aborts if a different Session becomes active, so it never
   fights the reader or restores into another conversation.

## Desktop boot manifest guard

Desktop captures its boot injections when the Host starts and reuses them for
every page reload. After a client bundle rebuild, a reload therefore asks for the
old revision; the Host may no longer serve it, and the boot fails with
`bundle script … failed to load`. This is a property of the Desktop shell, not of
this plugin.

The full-refresh path compares the live graph with `window.__DSH_BOOT__` before
reloading: the release, every entry revision/url, and every batch revision. If
they differ, it applies the graph through `entries.sync()` instead of reloading,
and the button shows `已热刷新`. If the release itself changed, it refuses the
reload and asks for an app restart. A genuine full reload happens only while the
boot manifest is still current, so it cannot request a missing artifact.

If DSH is already showing the web-boot crash screen, quit it fully and reopen it
once; that starts a fresh Host and fresh boot injections. The Session, its
transcript, and the saved draft are durable across that restart.

## Scope and limits

- **Full refresh fetches the new shell too**; hot refresh does not. On Desktop,
  a changed client-plugin graph makes the full-refresh path fall back to hot
  refresh automatically; a true full reload after plugin changes needs an app
  restart, because the Desktop shell reuses its Host-start boot injections.
- **Hot refresh only applies the page's boot release.** If the Host has been
  replaced by a different release, `entries.sync()` refuses the graph; the
  plugin reports `Host 已升级，需要重启 DSH` instead of silently doing nothing.
  Restarting the app is the recovery path.
- **Scroll restoration is per tab.** It uses `sessionStorage`, which is exactly
  the same-tab lifetime a reload needs; opening a new tab does not inherit it.
- **Scroll restoration is best effort.** It runs for at most 6 seconds while
  history and streaming content settle. If the conversation has not been
  reselected by then, no position is applied.
- **The header action needs a selected conversation.** On the home/blank screen
  there is no session title row; use F5 (Desktop) or bind the command on Web.
- **The icon carries the state.** Busy spins, a completed hot refresh shows a
  check, and a refusal shows an exclamation in the warning colour; the tooltip
  and the visually hidden status line carry the explanation.
- **A visible error is reported, not swallowed.** A failed hot refresh leaves
  the page untouched and shows `热刷新失败`; a failed full refresh cancels the
  reload and shows `刷新失败` rather than risking a broken boot.

## Install

The package is a workspace bundle: `package.json` declares `dsh.bundle.patch`
(the Loader row) and `dsh.client` (the browser module).

```
plugin_manager install_bundle  target: <absolute path to this directory>
```

Or add exactly **one** path-like row to the patch file of the surface you use —
the CLI's `web` profile and the Desktop app keep separate profiles:

```yaml
# ~/.dsh/profiles/desktop/cordis.patch.yml
- insert:
    - id: ui-refresh
      name: 'file:///G:/workspace/ai-gen/dsh-plugins/dsh-refresh/lib/index.js'
```

Then refresh the page (the very feature being installed can be used for its own
next reload). Do **not** add both the path row and the bundle layer: they share
the `ui-refresh` id and the Loader refuses a duplicate.

**Uninstall**: remove the row (or the bundle layer) and refresh.

## Layout

| File | Role |
|---|---|
| `lib/index.js` | Node half: the read-only `GET /dsh-refresh/graph` route over `ctx.clientModules.graph()` |
| `lib/client.js` | Browser half: the header icon action, the full-reload snapshot/restore, the hot-refresh driver, the F5 command, and the zh/en dictionaries |
| `cordis.patch.yml` | Bundle-layer install path (inserts `ui-refresh` by a relative name) |

## Verified against

- DSH Desktop client packages `0.2.1-rc.2` (the installed app): the module
  system, `conversation.session.header.actions`, `ctx.shortcuts`, `ctx.sessions`,
  `data-conversation-content` / `data-conversation-scroll`, and the
  `dsh-app://app/` protocol handler.
- `dsh web` uses the same client packages and the same header action slot; the
  only surface difference is the shortcut default (Desktop only) because
  browsers own F5.
- The header action is render-tested with a mock slot runtime: slot name/id/order,
  the 28px icon button, and normal versus Shift+click dispatch.
- The Desktop boot-manifest guard is branch-tested against four states: matching
  manifest → reload; changed entry/batch → hot refresh; changed release → error
  without reload; Web → reload.
