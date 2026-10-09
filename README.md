# DSH plugins

DeepSeek Harness plugins maintained here. Each immediate subdirectory is one
plugin package, installed into a dsh profile by adding its Loader row to that
profile's `cordis.patch.yml` — see the plugin's own README for the row and why
it is written the way it is.

| Plugin | What it does |
| --- | --- |
| [`dsh-turn-diff`](dsh-turn-diff/) | Read-only per-turn diff page in the right Sidebar: aggregates one turn's `write` / `edit` hunks per file, with a collapsible section each. |
