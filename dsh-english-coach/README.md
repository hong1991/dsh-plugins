# dsh-english-coach

An English writing coach for the DeepSeek Harness Web UI. While you keep using
the agent normally, it reviews the English prompts you actually write, records
the mistakes it finds, and lets you look words up without leaving the app.

It never rewrites your prompt. The model still receives exactly what you typed;
the review is a receipt, not a gate.

## What you see

**A receipt above the composer.** After an English message, a one-line strip
appears:

```
✏️ 2 处可改进 · 搭配 / 时态
   I very like this design      → I really like this design
   I have went to … yesterday   → I went to … yesterday
```

Expand it for the individual fixes and a one-sentence explanation each. Dismiss
a review you do not want to see; open the notebook from the same row.

**A coach page in the sidebar.** The pencil icon opens four tabs:

- **Overview** — reviews, issues, issues per 100 words, word count, issue
  distribution, the last 8 weeks, and the most recent reviews.
- **Notebook** — every reviewed sentence with its fixes, filterable by category
  and searchable. Mark an issue as mastered or dismiss a false positive.
- **Dictionary** — look up a word or phrase, then keep it in the wordbook.
- **Settings** — automatic review on/off, quiet mode, level, review model,
  minimum words, explanation language, and export.

**Commands.** `/word <term>` looks a word up from the keyboard. `/english`
prints a short report; `/english on|off` toggles automatic review.

## How it works

The Node half listens to `agent/inbox/claimed`, so it only reviews messages that
actually enter a turn. A message passes the gate when Latin letters dominate and
it has at least `minWords` words after code blocks, inline code, URLs, and file
references are stripped; pure acknowledgements and commands are skipped.
Subagent sessions are ignored.

The review is one `ctx.llm.stream()` call with a strict JSON instruction. The
reply is validated before anything is stored: a `before` span that is not an
exact substring of the original is dropped, categories must be known, at most
five issues survive, and a clean sentence becomes a `clean` review. A reply that
is not JSON is retried once with a stricter instruction; a second failure is
logged and dropped, never surfaced as a turn error.

Reviews and words live in `$DSH_HOME/english-coach/state.json`, written with a
temp-file rename. The model is never told about them.

The browser half gets its data from a small same-origin JSON route registered on
the Host's existing web server. A third-party bundle cannot add its own
`ctx.remote.*` namespace (that is build-time codegen), so the route is the
supported bridge; `dsh-refresh` uses the same pattern. The dock polls it every
three seconds while the page is visible.

| Route | Purpose |
| --- | --- |
| `GET /dsh-english-coach/api/state?sessionId=` | the composer strip (latest review, pending flag) |
| `GET .../meta` | preferences, categories, storage path |
| `GET .../reviews?limit=&issues=1&category=&q=` | the notebook |
| `GET .../stats?weeks=8` | the overview |
| `GET .../lookup?term=` | the dictionary |
| `POST .../review` | review arbitrary text: `{ text, sessionId?, store? }` |
| `POST .../issues` | dismiss / master / restore one issue |
| `POST .../words` | save or unsave a word |
| `POST .../prefs` | save preferences |
| `GET .../export?format=md\|json` | download the notebook |

## Install

The package is a bundle: its `cordis.patch.yml` inserts one row, and the same
row carries the `dsh.client` declaration.

```yaml
# this package's cordis.patch.yml
- insert:
    - id: english-coach
      name: './lib/index.js'
```

Install it as a bundle layer with the plugin manager, or point a profile patch
row at the module directly:

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- insert:
    - id: english-coach
      name: 'file:///G:/workspace/ai-gen/dsh-plugins/dsh-english-coach/lib/index.js'
```

Do not do both: the two rows share one id and the Loader refuses a duplicate.
The browser half is loaded by the client module system; reload the page once
after the row is live.

**Uninstall**: remove the row (or the bundle layer) and reload.

## Settings and storage

The panel's Settings tab edits the stored preferences; they override the
deployment defaults baked into `lib/index.js`. The row's `config` is only a
default source:

```yaml
- id: english-coach
  config:
    enabled: true
    level: intermediate
    coachModel: deepseek/deepseek-chat
    minWords: 4
```

| Preference | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Review incoming messages automatically |
| `quiet` | `false` | Record but never show the composer strip |
| `showClean` | `false` | Also show the strip when the text is correct |
| `level` | `intermediate` | Prompt hint for the coach |
| `coachModel` | empty | `provider/model`; empty follows the default model |
| `minWords` | `4` | Minimum Latin words before a review starts |
| `maxInputChars` | `2000` | Review input cap |
| `maxReviewsPerDay` | `300` | Cost guard |
| `explainLocale` | `zh` | Language of the short explanations |

Data: `$DSH_HOME/english-coach/state.json` (reviews capped at 5000, words cached
for 30 days). Export Markdown or JSON from the Settings tab; the download is
generated by the Host and written nowhere.

Dictionary lookups degrade through three layers: the free
`api.dictionaryapi.dev` entry, the built-in `ctx.translator` for a Chinese gloss,
and finally the review model itself — so lookup still works on networks where
the free dictionary is unreachable. The source of the entry is shown in the
card.

## Privacy

A review sends the message text to the model provider you already configured.
Records and wordbook entries are stored only on this machine. Turn automatic
review off in Settings or with `/english off` to stop the requests.

## Files

| File | Role |
| --- | --- |
| `lib/index.js` | Node half: capture, gate, model call, state, JSON route, commands |
| `lib/client.js` | Browser half: the dock strip, the coach page, the dictionary |
| `cordis.patch.yml` | The bundle-layer row |
| `locale/*.json` | Plugin Manager display metadata |
| `icon.svg` | Original icon for the plugin inventory |

## Known limits

- The dock polls; there is no push channel. A review normally lands within a
  poll or two of the answer.
- The notebook shows the latest 100 matches; export for the rest.
- The review model is chosen per profile, not per session.
- Reviews of very long messages are truncated at `maxInputChars`.
- Only messages whose Latin-letter share is at least 60% are reviewed; a
  mostly-Chinese message with an English clause is skipped to save a call.
