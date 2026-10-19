# DSH plugins

DeepSeek Harness plugins maintained here. Each immediate subdirectory is one
plugin package, installed into a dsh profile by adding its Loader row to that
profile's `cordis.patch.yml` — see the plugin's own README for the row and why
it is written the way it is.

| Plugin | What it does |
| --- | --- |
| [`dsh-turn-diff`](dsh-turn-diff/) | Read-only per-turn diff page in the right Sidebar: aggregates one turn's `write` / `edit` hunks per file, with a collapsible section each. |
| [`dsh-session-find`](dsh-session-find/) | Ctrl+F-style find bar over the rendered conversation: highlights every match, steps through them, and can page earlier history in while searching. |
| [`dsh-refresh`](dsh-refresh/) | One-click refresh in the conversation header that keeps the current conversation and scroll position; Shift+click hot-reloads client plugins in place without a page reload. |
| [`dsh-english-coach`](dsh-english-coach/) | Background review of your English prompts, a mistake notebook, and a dictionary — a receipt above the composer plus a sidebar coach page. |
