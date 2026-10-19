# 英语教练（dsh-english-coach）设计稿

> 状态：P0 已实现，代码在 [`dsh-english-coach/`](../dsh-english-coach/)；P1/P2 未做。
> 目标读者：本仓库的插件作者（你）。

## 0. 一句话

在你用外语（默认英语）给 agent 写 prompt 时，插件在**旁路异步**批改这句话，把错误**结构化**地记进错题本，并从你的历史错误里总结模式；同时提供**不离开对话**的查词入口。它不改写你的 prompt，也不打断对话。

## 1. 设计原则

1. **只批改用户，不批改助手。** 助手的英文不是学习信号，用户自己写出来的才是。
2. **不阻塞、不改写。** 批改在后台完成；发给模型的原文一字不改。纠错是回执，不是闸门。
3. **结构化优先。** 错误必须是数据（分类 / 片段 / 改法 / 解释），不是一段自由文本，才能聚合出「你的问题」。
4. **安静优先。** 默认只显示一行摘要，细节按需展开；误报可一键忽略；可以切到「只记录、不打扰」。
5. **数据归你。** 本地存储，随时导出 Markdown / JSON。
6. **语言无关的引擎，先只开英语。** 语言检测、prompt、分类都按 `languages` 配置来，v1 只启用 `en`。

## 2. 三个核心场景

### 场景 A：日常提问，回答后顺手看一眼

```
你 > I very like this design, but I have went to the wrong page yesterday.

（助手正常回答，不受影响……）

┌─ ✏️ 2 处可改进 · 搭配 / 时态 ───────────────────────────────┐
│  I very like this design        → I really like this design   │
│  搭配：very 不能直接修饰动词，用 really / very much             │
│  I have went to … yesterday     → I went to … yesterday       │
│  时态：有明确过去时间时用一般过去时                             │
│                                          [查看错题本] [收起]   │
└──────────────────────────────────────────────────────────────┘
```

- 位置：输入框上方（`conversation.input.dock`），随会话常驻。
- 时机：批改完成后出现，通常在助手回答前/中就绪，**从不阻塞发送**。
- 多条时只展开前 2 条，其余折叠。
- 没有错误时不出现（可配置成极淡的 ✓）。

### 场景 B：错题本，发现模式

```
英语教练
┌ 概览 ─┬ 错题本 ─┬ 生词本 ─┬ 设置 ┐

本周 42 句 · 63 个问题 · 每百词 4.8 个
最常犯：冠词 18 · 中式表达 11 · 时态 9
近 8 周：▁▂▃▅▄▃▂▁（下降中）

今天
  I very like this design → I really like this design
    [搭配] [已掌握] [忽略]                        打开会话 ↗
  ...
```

- 列表按天分组，可按分类 / 会话 / 未掌握筛选。
- 点开一条：原文 diff、每条的改法与解释、所属会话（点开跳回会话）。
- 顶部给「本周重点」：一句人话总结 + 建议练什么。

### 场景 C：查词

四个入口，按摩擦从低到高：

1. 纠错卡片里**点任意单词** → 查词浮层。
2. 面板顶部搜索框（输入或粘贴）。
3. `/word <term>` 命令：不离开键盘，结果作为命令输出。
4. 模型工具 `dictionary_lookup`：当你说「这个词什么意思」时模型调用，避免它自己编。

结果卡：词头 / 音标 / 词性 / 中文释义 / 英文释义 / 例句 / 常见搭配 / 易错点 / 「＋生词本」。

## 3. 功能设计

### 3.1 实时批改

**触发**

- 监听 `agent/inbox/claimed`：消息真正进入本轮时才批改（被丢弃/被拒绝的消息不浪费一次调用）。
- 按 `message.id` 关联 `session/event` 里的 `user/message`，拿到 `seq`（用于「跳回会话」）。
- 过滤（全部可配置）：
  - 去掉代码块、行内代码、URL、`@文件` 引用、引用块后再判断；
  - 拉丁字母占比 ≥ 60%，且词数 ≥ `minWords`（默认 4）；
  - 跳过以 `/` 开头的命令、纯附件、纯确认词（ok / thanks / continue）；
  - 超过 `maxInputChars`（默认 2000）截断或跳过；
  - 同一文本 10 分钟内命中缓存，不重复调用。
- 每会话同时最多 1 个批改任务；agent dispose / 会话关闭时 abort。

**模型调用**

- `ctx.llm.stream({ provider, model, system, messages, maxTokens, temperature: 0, signal })`。
- 模型选择 `coachModel`：
  - `session`：跟随当前会话路由（零配置，但可能用上推理模型，贵）；
  - `provider/model`：显式指定便宜模型（推荐，例如 `deepseek/deepseek-chat`）。
- 输出必须是严格 JSON；解析失败追加「只输出 JSON」重试一次；仍失败则记 `status: 'error'`，静默，不打扰用户。

**Prompt 要点**

- 角色：面向 `{level}` 学习者（默认 intermediate）、母语中文的写作教练。
- 只分析用户这句话，**不要回答它**；保留原意，不为风格改写。
- 只标真正的错误或明显非母语表达；最多 5 条；没有错误就返回空数组。
- 解释用 `{locale}`，每条一句话。
- 输出 schema：

```json
{
  "corrected": "完整改写句",
  "rewrite": "更地道的说法，可为 null",
  "issues": [
    {
      "category": "collocation",
      "before": "very like",
      "after": "really like",
      "note": "very 不能直接修饰动词",
      "severity": "major"
    }
  ]
}
```

**校验（防幻觉）**

- `category` 必须在枚举里，否则丢弃；
- `before` 必须是原文子串（允许大小写/空白归一化），否则丢弃；
- 最多 5 条，`note` 截断 200 字；
- `issues` 非空时 `corrected` 必须与原句不同。

**结果结构**

```ts
type Review = {
  id: string                 // `${sessionId}:${seq}`
  sessionId: string
  sessionTitle?: string      // 快照，错题本里显示用
  seq: number
  turn: number
  at: number
  lang: string               // 'en'
  text: string               // 原文（隐私模式下可只存 hash/长度）
  corrected: string | null
  rewrite: string | null
  issues: Issue[]
  model: string
  status: 'ok' | 'clean' | 'error'
}

type Issue = {
  category: Category         // 见 §6
  before: string
  after: string
  note: string
  severity: 'minor' | 'major'
  dismissed?: boolean        // 误报
  mastered?: boolean         // 已掌握
}
```

**展示规则**

- `status: 'ok'`：摘要条 + 展开详情。
- `status: 'clean'`：默认不显示（可配置 ✓）。
- `status: 'error'`：不显示；面板里能看到「未批改」计数。
- 每条 issue 有「忽略」（误报，进入抑制列表）和「已掌握」。
- 同一 `(category, before, after)` 被忽略两次后，后续批改自动过滤掉。

### 3.2 错题本与洞察

- **列表**：时间倒序、按天分组；筛选（分类 / 会话 / 未掌握 / 时间范围）；搜索原文和改法。
- **聚合**：
  - 分类计数与占比；
  - 错误密度 = issues / 词数 × 100（比绝对数量更能反映进步）；
  - 近 8 周趋势；
  - 「最常犯 Top 3」+ 每个分类最近的 3 个例子；
  - 连续使用天数（趣味指标，可选）。
- **本周重点**：一个可选的小 LLM 调用，把统计翻译成一段中文建议（「本周冠词问题集中在抽象名词前，建议……」）。
- **掌握度**：手动标记；某分类连续 N 周不出现时，提示「可以标记已掌握」。
- **导出**：Markdown（按分类整理，可直接复习）或 JSON（全量备份），浏览器直接下载，不写磁盘。

### 3.3 查词与生词本

- **数据源分层**（可配置）：
  1. 本地缓存（命中即回，离线可用）；
  2. 免费词典 API（英文释义、音标、例句）；
  3. `ctx.translator`（匿名 google/bing，中文释义，免 key）；
  4. 可选 LLM 补：搭配、易错点、针对你水平的例句。
- **归一化**：小写、去首尾标点、短语保留空格；缓存 TTL 30 天。
- **生词本**：手动添加（默认不自动收录，避免噪音）；记录来源（查词 / 纠错）和原句；P2 加复习模式。
- **查词浮层**：面板内和纠错卡片内共用同一个组件；点遮罩 / Esc 关闭。

### 3.4 练习（P2，闭环的关键）

用**你自己写错的句子**生成练习，而不是通用题库：

- 改错题：给出原句，让你改；
- 填空题：挖掉错误片段；
- 造句题：用你反复用错的搭配造句。

简单的间隔重复（again / hard / good），下次复习时间存在生词本 / 错题本记录上。

### 3.5 设置

面板里的「设置」页（写进插件私有存储，不改 profile 配置）：

- 开关、目标语言、水平（beginner / intermediate / advanced）；
- 批改模型（session / 指定 provider/model）；
- 触发阈值（minWords、每日上限、安静模式）；
- 解释语言；
- 「让主模型别抢答纠错」开关；
- 数据导出 / 清空；
- 隐私说明（批改文本会发给模型提供商）。

插件 `Config` 只放部署默认值；面板里的用户偏好覆盖它，优先级写清楚。

## 4. 数据模型（存储）

建议用 Host 的 domain KV（`ctx.storageDomain`），domain 名 `english-coach`，version 1：

| 表 | key | value |
| --- | --- | --- |
| `reviews` | `sessionId:seq` | `Review` |
| `words` | 归一化词条 | `WordEntry`（释义、来源、复习状态） |
| `global` | — | `{ prefs, dismissed: string[], schemaVersion }` |

- 统计实时从 `reviews` 算出，不单独存，避免不一致。
- 容量：默认保留最近 5000 条 review，超出按时间淘汰（可配置）。
- 备选：写工作区 `english-coach/journal.jsonl`——可读、可 git、可手动编辑，但跨工作区不统一，且需要处理 fs 权限。**默认私有存储，导出交给下载。**

## 5. 技术架构

```
┌────────────────────────── Host（Node） ───────────────────────────┐
│  agent/created ──► 注册 per-agent 监听（agent.ctx.effect）         │
│  agent/inbox/claimed ──► LanguageGate ──► ReviewQueue（每会话 1）  │
│                                     │                             │
│                                     ▼                             │
│                          ctx.llm.stream（严格 JSON）               │
│                                     │                             │
│                          校验 / 去重 / 抑制                        │
│                                     ▼                             │
│                        storageDomain：reviews / words / global     │
│                                     │                             │
│  webServer 路由 /dsh-english-coach/api/*  ◄── 查询 / 操作          │
│  tools：dictionary_lookup / english_review / english_report        │
│  command：/word；/english（报告、开关）                            │
└───────────────────────────────────────────────────────────────────┘
                                    ▲ 同源 fetch（JSON）
┌────────────────────────── Client（浏览器） ───────────────────────┐
│  conversation.input.dock ──► 最近一条批改摘要条（可展开/忽略）      │
│  sidebar.panellist + main ──► 「英语教练」页（概览/错题本/生词本）  │
│  查词浮层（面板内 + 卡片点词）                                     │
└───────────────────────────────────────────────────────────────────┘
```

### 5.1 Client ↔ Host 通道

**约束**：第三方 bundle 的 `ctx.remote.*` 命名空间是构建期 codegen 生成、能力集固定在 `dsh-api-remotes` 里的，插件**加不了自己的 Remote 命名空间**。

**方案**：Host 用 `ctx.webServer.register()` 注册只读 + 少量写操作的 JSON 路由，Client 用同源 `fetch`。本仓库的 `dsh-refresh` 已经验证过这个模式（`/dsh-refresh/graph`），沿用它。

**为什么不用会话命令做查询**：每次 `commands.execute()` 都会写 `command/run` + `command/done` 两条会话事件，轮询会把会话日志刷满；命令只适合低频、由用户显式触发的动作。

**推送**：MVP 用轮询——dock 挂载时拉一次，`useChat` 看到新消息后再短轮询几次；面板按需拉。需要实时再上 SSE（同一路由 `text/event-stream`），不进 MVP。

**安全**：路由只在 loopback 上可达，和 GUI 同一个信任域；不放敏感数据，写操作只影响插件自己的存储。注意 webServer 可能绑到非 loopback，实现时确认 bind 地址，必要时校验 Host / 来源。

### 5.2 Host 侧要点

- `agent/created` 里在 `agent.ctx` 上注册监听，用一个 `agent.ctx.effect()` 包住，并把这个 disposer 同时存在插件自己的 effect 里（规范要求双持有，防泄漏）。
- 用 `agent/inbox/claimed`，不要全量 `session/event` 扫描。
- **不**调用 `agent.inject()`，**不**改 `agent/pre-step` 的消息——不碰主流程。
- 可选：`ctx.systemPrompt.section()` 加一句「用户在用外语练习；除非被明确要求，否则不要在回答里纠正其语法」，避免主模型和教练重复纠错。默认开，可关。
- `agent/disposed` 时清掉该会话的队列和缓存。
- LLM 失败只写 `status: 'error'`，不向会话抛错。
- 所有 timers / listeners / 队列都走 `ctx.effect()` 或 `ctx.on()`，插件卸载时干净退出。

### 5.3 Client 侧要点

- 摘要条：`conversation.input.dock`（list，session scope），标准 props 里有 `sessionId`、`useChat`、`useConversation`。
- 面板：`sidebar.panellist` 注册 id `english-coach` 的图标 + `main` 里注册同 key 的页面（宿主用 id 寻址）。
- **不用** `conversation.chat.turnTail`：本仓库的 `dsh-turn-diff` README 记录过它在两个构建里是 chain 语义，只有第一个接受的条目渲染；`input.dock` 是加法式的 list，更稳。
- 不做 DOM 注入、不读别的插件的 DOM；样式只用 `--dsw-alias-*` 主题 token，文案走 Client locale。
- 图标在两个构建里名字会漂移（Desktop vs Web），自己画 SVG，不依赖宿主 icon 名。

### 5.4 工具与命令（给模型和键盘用）

| 名称 | 类型 | 作用 |
| --- | --- | --- |
| `dictionary_lookup` | tool | 查词，返回结构化释义；模型在用户问词义时调用 |
| `english_review` | tool | 批改指定文本（缺省用最后一条用户消息），返回 issues |
| `english_report` | tool | 返回区间统计 + Top 错误，供模型总结 |
| `/word <term>` | command | 快速查词，结果走命令输出 |
| `/english` | command | 生成文字版周报 / 开关本会话批改 |

工具数量控制在 3 个，避免每轮请求多背太多 schema。

## 6. 错误分类（枚举）

| id | 中文 | 例子 |
| --- | --- | --- |
| `spelling` | 拼写 | `recieve` → `receive` |
| `article` | 冠词 | `go to library` → `go to the library` |
| `tense` | 时态 | `I have went yesterday` → `I went yesterday` |
| `agreement` | 主谓一致 | `He go` → `He goes` |
| `preposition` | 介词 | `discuss about it` → `discuss it` |
| `word-form` | 词形/词性 | `success` → `successful` |
| `collocation` | 搭配 | `very like` → `really like` |
| `word-choice` | 用词 | `big rain` → `heavy rain` |
| `word-order` | 语序 | `I know not` → `I don't know` |
| `plural` | 单复数/可数性 | `many information` → `much information` |
| `chinglish` | 中式表达 | `open the light` → `turn on the light` |
| `register` | 语域/语气 | 对正式场合用 `wanna` |
| `punctuation` | 标点/大小写 | 句首小写、缺逗号 |
| `concision` | 冗余 | `in my personal opinion` → `in my opinion` |

分类要少而稳（14 个够用），多了既难标注也难统计。

## 7. 成本与延迟

- 一次 50 词批改 ≈ 1–2k tokens；便宜模型下约「几分钱 / 百条」。
- 异步执行，不占主回复的延迟；失败静默。
- 默认护栏：`minWords: 4`、`maxInputChars: 2000`、`maxReviewsPerDay: 300`、每会话并发 1。
- 面板显示本周批改次数和估算 token，让成本可见。

## 8. 分期

**P0 · 能用（先验证核心假设）**

1. Host：`agent/inbox/claimed` → 语言门 → LLM 批改 → 私有存储。
2. Client：`input.dock` 摘要条（展开、忽略、跳错题本）。
3. 面板：错题本列表（只读）。
4. `/word` + 面板查词（免费词典 + 翻译）。
5. 开关、语言、模型配置。

**P1 · 好用**

统计与趋势、本周重点、忽略/已掌握的完整闭环、导出、生词本、SSE 实时、每会话开关。

**P2 · 上瘾**

用错句生成练习 + 间隔重复、多语言、可换词典源（有道/欧路/本地词库）、发音音频、周报推送。

## 9. 风险与对策

| 风险 | 对策 |
| --- | --- |
| Client↔Host 通道在 Desktop/Web 两个构建里不一致 | 先做 30 行 spike：Host 注册路由 + Client fetch，两个表面都验证；沿用 `dsh-refresh` 的写法 |
| 误报损伤信任 | 保守 prompt；`before` 必须是原文子串；只显示 major；一键忽略进入抑制列表 |
| 每条都弹太吵 | 默认一行摘要 + 可收起；「安静模式」只记录；clean 不显示 |
| LLM JSON 不稳定 | 严格 schema + 一次修复重试 + 失败静默 |
| 成本失控 | 便宜模型、截断、每日上限、成本可见 |
| `storageDomain`/zod 在第三方 bundle 里不可用 | 先 spike；不可用则回落 `$DSH_HOME` 下的 JSON 文件（或工作区 journal） |
| 宿主 slot 语义随版本漂移 | 只用 additive list slot（`input.dock`）、`sidebar.panellist` + `main`；不用 turnTail |
| 隐私顾虑 | 本地存储、可清空、面板明示「文本会发给模型提供商」、隐私模式下不存原文 |

## 10. 不做什么

- 不做浏览器级划词/语法高亮（宿主 DOM 不归插件管）。
- 不做口语、发音评分。
- 不改写用户的 prompt，不把纠正版本偷偷塞给主模型。
- 不在 v1 做账号、云同步、社区题库。

## 11. 已定的默认值（P0 按此实现）

1. 纠错出现在输入框上方的一行摘要（`conversation.input.dock`）。
2. 不把纠正版偷偷作为上下文给主模型——保留你真实的表达。
3. 数据存插件私有 JSON（`$DSH_HOME/english-coach/state.json`），导出走浏览器下载。
4. 词典源：免费词典 API → 内置 `ctx.translator` → 模型兜底（实测前两层不可达时第三层可用）。
5. 先只做英语，检测、prompt、分类都留了 `languages` 口子。

P1 再讨论：错题卡片里点词查词、`dictionary_lookup` / `english_review` 工具、每会话暂停、SSE 实时、用错句生成练习。
