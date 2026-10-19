# dsh-session-find

A Ctrl+F style find bar for the current DeepSeek Harness conversation: type text,
see every match highlighted in the transcript, and step through them with
previous/next.

## What it does

- **Ctrl+F** (Desktop) opens the bar above the composer; the same bar is always
  reachable from its own **Find** button in the composer dock.
- **Live highlighting** of every match through the CSS Custom Highlight API, with
  the current match painted stronger.
- **Previous / next** with Enter and Shift+Enter (or the ↑ / ↓ buttons); the
  current match is scrolled to the centre of the conversation.
- **Searches earlier history automatically** — the conversation renders only the
  window it has loaded, so a query with no match there pages one window at a time
  back through the retained session's own `loadOlder()` until it finds a match,
  history ends, or a bounded scan budget is spent. The **load earlier** button
  pages one more window on demand; the count then covers everything loaded.
- Escape closes the bar and clears the highlighting.

## Chain-of-thought is never matched

The Conversation layer does not render reasoning blocks, so a search over the
rendered transcript cannot report chain-of-thought text — no block-type filter
has to be kept in sync with the Host's own index. Matching is literal and
case-insensitive within one text node, so Chinese substrings work; the shipped
Host full-text index is SQLite FTS5 with the `unicode61` tokenizer and does not
match Chinese substrings at all.

## Scope and limits

- Searches the **current conversation**. History outside the loaded window is
  paged in automatically when a query finds nothing there, up to a bounded number
  of pages; the bar's button pages further on demand. Other sessions are not
  searched.
- Matches are found per text node, so a query spanning two inline elements that
  split the text (for example a phrase broken by `<strong>`) is not matched.
- The conversation views are searched. The composer region that shares their
  scrollport — the contenteditable draft, the model selector, and the composer's
  own controls — is excluded, as are hidden and `aria-hidden` subtrees.
- Desktop defaults bind the platform primary modifier + F. Web is left unbound
  because browsers reserve that combination for their own find.

## Install

This package is a workspace bundle: `package.json` declares
`dsh.bundle.patch` (the Loader rows) and `dsh.client` (the browser module). It
carries no Host behavior — `lib/index.js` exists only so an enabled Loader entry
has a module to load.

```
plugin_manager install_bundle  target: <absolute path to this directory>
```

Changes affect every session in the profile and survive restart.

## Layout

| File | Role |
|---|---|
| `package.json` | Bundle patch declaration, `./client` export, and the `dsh.client` manifest |
| `cordis.patch.yml` | Inserts the `session-find` Loader row |
| `lib/index.js` | Node half: declares nothing |
| `lib/client.js` | Browser half: the find bar, the search, and the Ctrl+F command |
