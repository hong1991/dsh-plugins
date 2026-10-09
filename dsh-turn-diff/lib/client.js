/**
 * dsh-turn-diff, browser half.
 *
 * One read-only surface: a page tab in the right Sidebar that shows what a
 * single turn changed, aggregated per file. The data is already in the browser
 * — every settled `write` / `edit` / `str_replace_editor` result carries its
 * applied hunks in `tool/result` metadata (`meta.diffs`), which the session log
 * persists and the Chat snapshot projects. So this plugin reads the snapshot it
 * is handed, groups the hunks by path, and draws them with the shipped
 * `DiffBlock` — the same primitive the tool rows already use.
 *
 * Two integration points, both additive:
 *
 * - `conversation.chat.assistant-actions` (a `list` slot) contributes a button
 *   to the closing assistant message of any turn that changed files. The slot
 *   is additive, unlike `conversation.chat.turnTail`, whose chain only ever
 *   renders its first accepting selector — the produced-files row already
 *   occupies that seat.
 * - `ctx.sidebarRightTabs` registers a page type; its body rides the keyed
 *   `sidebar.right.pane.tab` seat under this plugin's `id`.
 *
 * The button computes the aggregate from the live snapshot and hands it to the
 * body through a small bounded stash keyed by a token carried in the tab's
 * navigation params. That keeps the body free of any chat-store coupling: it
 * renders exactly what was opened, and shows a hint when a page reload left the
 * stash empty.
 *
 * @module dsh-turn-diff/client
 */
window.__ModuleLoader__.load({
	id: "dsh-turn-diff",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		const h = react.createElement;

		// Primitive *names* drift between releases even though the sealed module
		// table does not: 0.1.5-rc names icons `…Outline14` / `…Outline16`, while
		// the Desktop build ships `…OutlineRegular` / `…OutlineMedium`. Resolving
		// from a candidate chain and falling back to a text glyph keeps this plugin
		// loadable on both — `createElement(undefined)` throws and takes the whole
		// row down with it, which is exactly how it failed on Desktop.
		const iconOf = (...candidates) => candidates.find((candidate) => typeof candidate === "function") ?? null;
		const ICON_ENTRY = iconOf(primitives.IconListPenOutlineRegular, primitives.IconListPenOutline16);
		const ICON_OPEN = iconOf(primitives.IconChevronDownOutlineRegular, primitives.IconChevronDownOutline14);
		const ICON_CLOSED = iconOf(primitives.IconChevronRightOutlineRegular, primitives.IconChevronRightOutline14);

		/** Dictionary namespace owned by this plugin. */
		const NS = "turnDiff";
		/** The page type's kind, and the registration id its body is keyed under. */
		const KIND = "turn-diff";
		const TAB_ID = "dsh-turn-diff";
		/** Wire tool names whose result metadata carries applied hunks. */
		const MUTATING_TOOLS = new Set(["write", "edit", "str_replace_editor"]);

		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"action.label": "本轮 diff",
			"action.loading": "正在载入本轮…",
			"action.title": "查看本轮改动（{files} 个文件，+{added} −{removed}）",
			"action.titlePartial": "本轮开头不在已加载的历史里，行数暂不可靠；点开后会自动补齐并给出准确数字",
			"tab.title": "本轮 diff",
			"guide.title": "本轮 diff",
			"guide.description": "按文件查看某一轮对话改了哪些内容",
			"body.turn": "第 {turn} 轮",
			"body.summary": "{files} 个文件 · +{added} −{removed}",
			"body.hunks": "{count} 处",
			"body.expandAll": "全部展开",
			"body.collapseAll": "全部收起",
			"body.empty": "这一轮没有文件改动。",
			"body.missing": "这份 diff 数据已失效（页面刷新或重新载入后），请回到对话里重新点一下「本轮 diff」。",
			"body.note": "内容来自每次 write / edit 的结果 hunk（含 ±3 行上下文），不是完整的逐行文件 diff。",
			"body.partial": "其中 {count} 次改动所在的对话历史尚未加载，无法解析出文件：向上滚动对话加载更早历史后再打开可补全。",
			copy: "复制",
			copied: "已复制",
			collapse: "收起",
			collapseAria: "收起差异",
			expand: "… 其余 {count} 行",
			expandAria: "展开其余 {count} 行差异",
			"files.one": "{count} 个文件",
			"files.other": "{count} 个文件"
		};

		/** English dictionary (same key set). */
		const en = {
			"action.label": "Turn diff",
			"action.loading": "Loading this turn…",
			"action.title": "Review this turn's changes ({files} files, +{added} −{removed})",
			"action.titlePartial": "This turn starts before the loaded history, so its line counts are not yet reliable; opening it pages the rest in and reports exact numbers",
			"tab.title": "Turn diff",
			"guide.title": "Turn diff",
			"guide.description": "Review what one turn changed, grouped by file",
			"body.turn": "Turn {turn}",
			"body.summary": "{files} files · +{added} −{removed}",
			"body.hunks": "{count} hunks",
			"body.expandAll": "Expand all",
			"body.collapseAll": "Collapse all",
			"body.empty": "This turn changed no files.",
			"body.missing": "This diff is no longer available (the page reloaded). Reopen it from the “Turn diff” button in the conversation.",
			"body.note": "Content comes from each write / edit result's hunks (±3 context lines), not a full line-by-line file diff.",
			"body.partial": "{count} change(s) sit in conversation history that is not loaded, so their files cannot be resolved: scroll the conversation up to load older history, then open this again.",
			copy: "Copy",
			copied: "Copied",
			collapse: "Collapse",
			collapseAria: "Collapse diff",
			expand: "… {count} more lines",
			expandAria: "Expand the remaining {count} diff lines",
			"files.one": "{count} file",
			"files.other": "{count} files"
		};

		// ── diff extraction ─────────────────────────────────────────────────
		// Result metadata is opaque on the wire, so every field is validated the
		// same way the shipped tool card validates it: malformed metadata yields
		// undefined and falls back rather than throwing mid-render.

		/**
		 * Narrow opaque result metadata to well-formed hunks.
		 * @param meta - the tool result's `meta` field.
		 * @returns validated hunks, or undefined when the payload is unusable.
		 */
		function diffsFromMeta(meta) {
			if (meta === null || typeof meta !== "object" || Array.isArray(meta)) return undefined;
			const diffs = meta.diffs;
			if (!Array.isArray(diffs) || diffs.length === 0) return undefined;
			const out = [];
			for (const hunk of diffs) {
				if (hunk === null || typeof hunk !== "object") return undefined;
				const { path, oldText, newText } = hunk;
				if (typeof path !== "string" || path === "") return undefined;
				if (oldText !== null && oldText !== undefined && typeof oldText !== "string") return undefined;
				if (typeof newText !== "string") return undefined;
				out.push({ path, oldText: oldText === undefined ? null : oldText, newText });
			}
			return out.length === 0 ? undefined : out;
		}

		/**
		 * Derive a diff from a mutation call's own arguments, for results whose
		 * metadata is absent — a replayed window that dropped it, or an executor
		 * that never attached any. Coarser than the applied hunks, and the only
		 * fallback that needs nothing but the log.
		 * @param call - the settled call head (`name` plus raw arguments).
		 * @returns one derived diff, or undefined when the call is not a mutation.
		 */
		function diffsFromCall(call) {
			if (call === null || typeof call !== "object") return undefined;
			const { name, argsRaw } = call;
			if (typeof name !== "string" || typeof argsRaw !== "string") return undefined;
			if (!MUTATING_TOOLS.has(name)) return undefined;
			let args;
			try {
				args = JSON.parse(argsRaw);
			} catch {
				return undefined;
			}
			if (args === null || typeof args !== "object") return undefined;
			if (name === "str_replace_editor") {
				const { command, path, file_text: fileText, old_str: oldStr, new_str: newStr } = args;
				if (typeof path !== "string" || path === "") return undefined;
				if (command === "create") {
					if (fileText !== undefined && typeof fileText !== "string") return undefined;
					return [{ path, oldText: null, newText: fileText === undefined ? "" : fileText }];
				}
				if (command === "str_replace") {
					if (oldStr !== undefined && typeof oldStr !== "string") return undefined;
					if (newStr !== undefined && typeof newStr !== "string") return undefined;
					return [{
						path,
						oldText: oldStr === undefined || oldStr === "" ? null : oldStr,
						newText: newStr === undefined ? "" : newStr
					}];
				}
				return undefined;
			}
			const { file_path: filePath } = args;
			if (typeof filePath !== "string" || filePath === "") return undefined;
			if (name === "write") {
				const content = args.content;
				if (typeof content !== "string") return undefined;
				return [{ path: filePath, oldText: null, newText: content }];
			}
			const { old_string: oldString, new_string: newString } = args;
			if (typeof oldString !== "string" || typeof newString !== "string") return undefined;
			return [{ path: filePath, oldText: oldString === "" ? null : oldString, newText: newString }];
		}

		/**
		 * Fold one call tree's mutations into the turn's per-file buckets.
		 *
		 * Code Dispatch parents contribute only their children, and failed calls
		 * contribute nothing — the same rules the produced-files row follows.
		 *
		 * A settled result's own `call` head is the first choice for the argument
		 * fallback, but it is only backfilled when the paired `tool/call` event is
		 * still inside the loaded window. `heads` is the durable route: it is
		 * rebuilt from the assistant messages' own tool-call blocks, which every
		 * in-window step carries whatever the result kept.
		 * @param block - running or settled call.
		 * @param files - grouping-key accumulator, in first-seen order.
		 * @param heads - callId-keyed call heads recovered from the turn.
		 * @param stats - observation counters for the tab's optional diagnostics.
		 */
		function collectBlock(block, files, heads, stats) {
			if (block === null || typeof block !== "object") return;
			if (!("kind" in block)) {
				collectSubCalls(block.subCalls, files, heads, stats);
				return;
			}
			if (block.isError !== true) {
				const applied = diffsFromMeta(block.meta);
				if (applied !== undefined) {
					stats.hunks += 1;
					for (const diff of applied) appendDiff(files, diff);
				} else {
					if (Array.isArray(block.meta?.diffs) && block.meta.diffs.length === 0) stats.emptyMeta += 1;
					else if (block.meta === undefined) stats.noMeta += 1;
					const head = block.call ?? (typeof block.callId === "string" ? heads.get(block.callId) : undefined);
					if (head === undefined) stats.headless += 1;
					const derived = diffsFromCall(head);
					if (derived !== undefined) {
						stats.derived += 1;
						for (const diff of derived) appendDiff(files, diff);
					}
				}
			}
			collectSubCalls(block.subCalls, files, heads, stats);
		}

		/**
		 * Recurse into a call's children.
		 * @param subCalls - child calls in dispatch order.
		 * @param files - grouping-key accumulator.
		 * @param heads - callId-keyed call heads recovered from the turn.
		 * @param stats - observation counters.
		 */
		function collectSubCalls(subCalls, files, heads, stats) {
			if (!Array.isArray(subCalls)) return;
			for (const sub of subCalls) collectBlock(sub, files, heads, stats);
		}

		/**
		 * Fold a reported path to the key its file groups under: separators
		 * normalized and case folded. Result metadata relativizes `file_path`
		 * (the bridge stamps a workspace-relative path) while call arguments keep
		 * it absolute, and the same file must not split into two entries.
		 * @param path - a reported path.
		 * @returns the grouping key.
		 */
		function pathKey(path) {
			return path.replaceAll("\\", "/").toLowerCase();
		}

		/**
		 * Append one hunk under its path, keeping first-seen file order.
		 * @param files - grouping-key accumulator.
		 * @param diff - the hunk to append.
		 */
		function appendDiff(files, diff) {
			const key = pathKey(diff.path);
			let entry = files.get(key);
			if (entry === undefined) {
				entry = { path: diff.path, diffs: [] };
				files.set(key, entry);
			}
			entry.diffs.push(diff);
		}

		/**
		 * Merge buckets whose keys are suffix-related — the absolute and the
		 * relativized spelling of one file.
		 * @param entries - accumulator values, in first-seen order.
		 * @returns merged entries, the longer path kept as the label.
		 */
		function mergeSuffixes(entries) {
			const out = [];
			for (const entry of entries) {
				const key = pathKey(entry.path);
				const host = out.find((candidate) => {
					const other = pathKey(candidate.path);
					return key === other || key.endsWith(`/${other}`) || other.endsWith(`/${key}`);
				});
				if (host === undefined) {
					out.push(entry);
					continue;
				}
				if (pathKey(host.path).length < key.length) host.path = entry.path;
				host.diffs.push(...entry.diffs);
			}
			return out;
		}

		/**
		 * Recover every call head the turn still holds.
		 *
		 * Two sources, in trust order: a settled result's backfilled `call`, and
		 * the assistant messages' `tool-call` blocks — the second survives a
		 * window cut that dropped the result's paired head.
		 * @param snapshot - current Chat snapshot.
		 * @param turn - owning turn number.
		 * @returns callId-keyed `{name, argsRaw}` heads.
		 */
		function collectCallHeads(snapshot, turn) {
			const heads = new Map();
			const keys = snapshot.locations?.getTurn(turn);
			if (!Array.isArray(keys)) return heads;
			for (const key of keys) {
				const node = snapshot.nodes.get(key);
				if (node === undefined) continue;
				if (node.kind === "tool-call") {
					collectHeadsFromBlock(node.data?.root, heads);
					continue;
				}
				if (node.kind !== "assistant") continue;
				const blocks = node.data?.blocks;
				if (!Array.isArray(blocks)) continue;
				for (const block of blocks) {
					if (block === null || typeof block !== "object" || block.kind !== "tool-call") continue;
					if (typeof block.callId !== "string" || typeof block.argsRaw !== "string") continue;
					if (!heads.has(block.callId)) heads.set(block.callId, { name: block.name, argsRaw: block.argsRaw });
				}
			}
			return heads;
		}

		/**
		 * Recover call heads from one call tree, depth first.
		 * @param block - running or settled call.
		 * @param heads - accumulator.
		 */
		function collectHeadsFromBlock(block, heads) {
			if (block === null || typeof block !== "object") return;
			if (!("kind" in block)) {
				if (typeof block.callId === "string" && typeof block.argsRaw === "string" && !heads.has(block.callId)) {
					heads.set(block.callId, { name: block.name, argsRaw: block.argsRaw });
				}
			} else if (
				block.call !== null &&
				block.call !== undefined &&
				typeof block.call.argsRaw === "string" &&
				!heads.has(block.callId)
			) {
				heads.set(block.callId, block.call);
			}
			const subCalls = block.subCalls;
			if (!Array.isArray(subCalls)) return;
			for (const sub of subCalls) collectHeadsFromBlock(sub, heads);
		}

		// ── per-turn aggregation ────────────────────────────────────────────

		/** Per-snapshot aggregation cache: one snapshot's turns, computed at most once. */
		const turnDataCache = new WeakMap();
		/** Per-snapshot message lookup cache. */
		const locateCache = new WeakMap();

		/**
		 * Fold every hunk this turn applied, per file.
		 * @param snapshot - current Chat snapshot.
		 * @param turn - owning turn number.
		 * @returns files in first-seen order with their totals, plus a content hash
		 *   and the observation counters the tab can show while diagnosing.
		 */
		function collectTurn(snapshot, turn) {
			const heads = collectCallHeads(snapshot, turn);
			const files = new Map();
			const stats = {
				keys: 0,
				nodes: 0,
				missing: 0,
				heads: heads.size,
				hunks: 0,
				emptyMeta: 0,
				noMeta: 0,
				headless: 0,
				derived: 0
			};
			const keys = snapshot.locations?.getTurn(turn);
			if (Array.isArray(keys)) {
				stats.keys = keys.length;
				for (const key of keys) {
					const node = snapshot.nodes.get(key);
					if (node === undefined) {
						stats.missing += 1;
						continue;
					}
					if (node.kind !== "tool-call") continue;
					stats.nodes += 1;
					collectBlock(node.data?.root, files, heads, stats);
				}
			}
			const list = [];
			let added = 0;
			let removed = 0;
			let hash = 2166136261;
			for (const entry of mergeSuffixes([...files.values()])) {
				const totals = primitives.diffTotals(entry.diffs);
				const fileAdded = typeof totals.added === "number" ? totals.added : 0;
				const fileRemoved = typeof totals.removed === "number" ? totals.removed : 0;
				added += fileAdded;
				removed += fileRemoved;
				hash = hashString(hash, entry.path);
				for (const diff of entry.diffs) {
					hash = hashString(hash, diff.oldText === null ? "" : diff.oldText);
					hash = hashString(hash, diff.newText);
				}
				list.push({ path: entry.path, diffs: entry.diffs, added: fileAdded, removed: fileRemoved });
			}
			return { turn, files: list, added, removed, hash: (hash >>> 0).toString(36), stats };
		}

		/**
		 * Read one snapshot's aggregate for a turn, computing it at most once.
		 * @param snapshot - current Chat snapshot.
		 * @param turn - owning turn number.
		 * @returns the aggregate.
		 */
		function turnDataFor(snapshot, turn) {
			let byTurn = turnDataCache.get(snapshot);
			if (byTurn === undefined) {
				byTurn = new Map();
				turnDataCache.set(snapshot, byTurn);
			}
			let data = byTurn.get(turn);
			if (data === undefined) {
				data = collectTurn(snapshot, turn);
				byTurn.set(turn, data);
			}
			return data;
		}

		/**
		 * FNV-1a over a string, so a content change invalidates a cached
		 * aggregate even when its line counts match.
		 * @param hash - running hash.
		 * @param text - text to fold in.
		 * @returns the updated hash.
		 */
		function hashString(hash, text) {
			if (typeof text !== "string") return hash;
			const length = text.length;
			if (length > 262144) {
				hash = (hash ^ length) >>> 0;
				return Math.imul(hash, 16777619) >>> 0;
			}
			for (let index = 0; index < length; index += 1) {
				hash = (hash ^ text.charCodeAt(index)) >>> 0;
				hash = Math.imul(hash, 16777619) >>> 0;
			}
			return hash;
		}

		/**
		 * Resolve the turn an assistant message belongs to.
		 *
		 * The assistant Chat node carries both identities directly — `messageId`
		 * and a numeric `turn` on its data — so this is a lookup, not a
		 * re-derivation. The durable node projection is only a fallback for a
		 * window that materialized no Chat node for the message.
		 *
		 * Nothing here re-derives "closing": the `assistant-actions` strip is
		 * rendered by the turn tail under a turn's closing assistant only, so
		 * every action it asks for already belongs to one.
		 * @param snapshot - current Chat snapshot.
		 * @param messageId - the message this action belongs to.
		 * @returns the turn number, or null when the message is not in view.
		 */
		function locateTurn(snapshot, messageId) {
			if (typeof messageId !== "string") return null;
			const store = snapshot.nodes;
			if (store !== undefined && typeof store.values === "function") {
				for (const node of store.values()) {
					if (node.kind !== "assistant") continue;
					const data = node.data;
					if (data === undefined || data === null || data.messageId !== messageId) continue;
					if (typeof data.turn === "number") return data.turn;
				}
			}
			const nodes = snapshot.legacy?.nodes;
			if (Array.isArray(nodes)) {
				for (const node of nodes) {
					if (node.kind !== "assistant" || node.messageId !== messageId) continue;
					return typeof node.turn === "number" ? node.turn : null;
				}
			}
			return null;
		}

		/**
		 * Read a message's turn, memoized per snapshot.
		 * @param snapshot - current Chat snapshot.
		 * @param messageId - the message this action belongs to.
		 * @returns the turn number, or null.
		 */
		function turnOfMessage(snapshot, messageId) {
			let byMessage = locateCache.get(snapshot);
			if (byMessage === undefined) {
				byMessage = new Map();
				locateCache.set(snapshot, byMessage);
			}
			const key = typeof messageId === "string" ? messageId : "";
			if (byMessage.has(key)) return byMessage.get(key);
			const turn = locateTurn(snapshot, messageId);
			byMessage.set(key, turn);
			return turn;
		}

		/**
		 * Whether the loaded window still holds a turn's own start.
		 *
		 * The timeline resolves a turn's start from the events the projection
		 * actually holds, so an absent start means the turn reaches back past the
		 * window: its aggregate is then a lower bound, not the turn's total. The
		 * entry button uses this to avoid advertising a number it knows is short.
		 * @param snapshot - current Chat snapshot.
		 * @param turn - owning turn number.
		 * @returns whether the turn is fully inside the loaded window.
		 */
		function isTurnComplete(snapshot, turn) {
			const start = snapshot.timeline?.turns?.get(turn)?.start;
			return start !== undefined;
		}

		/**
		 * The selector value a button subscribes to.
		 *
		 * A React store selector must return something reference-stable between
		 * publications, and a fresh aggregate object never is — so this returns a
		 * string that both identifies the data (turn, content hash) and carries
		 * the label's numbers. The aggregate itself stays in the per-snapshot cache.
		 * @param snapshot - current Chat snapshot.
		 * @param messageId - the message this action belongs to.
		 * @returns a stable signature, or null when this turn changed nothing.
		 */
		function signatureOf(snapshot, messageId) {
			const turn = turnOfMessage(snapshot, messageId);
			if (turn === null) return null;
			const data = turnDataFor(snapshot, turn);
			if (data.files.length === 0) return null;
			const complete = isTurnComplete(snapshot, turn) ? 1 : 0;
			return `${turn}:${data.hash}:${data.files.length}:${data.added}:${data.removed}:${complete}`;
		}

		/**
		 * Read a signature's headline numbers.
		 * @param signature - a value returned by {@link signatureOf}.
		 * @returns the turn, its totals, and whether the turn is fully loaded.
		 */
		function summaryOf(signature) {
			const parts = signature.split(":");
			return {
				turn: Number(parts[0]),
				files: Number(parts[2]),
				added: Number(parts[3]),
				removed: Number(parts[4]),
				complete: parts[5] === "1"
			};
		}

		/** Bounded hand-off store between the button and the tab body. */
		const STASH_LIMIT = 12;
		const stash = new Map();
		let stashSeq = 0;

		/**
		 * Store one aggregate and mint the token that names it.
		 * @param data - the aggregate to hand over.
		 * @returns the token to carry in the tab's navigation params.
		 */
		function stashPut(data) {
			stashSeq += 1;
			const token = `td${stashSeq.toString(36)}`;
			stash.set(token, data);
			while (stash.size > STASH_LIMIT) {
				const oldest = stash.keys().next();
				if (oldest.done === true) break;
				stash.delete(oldest.value);
			}
			return token;
		}

		// ── window top-up ───────────────────────────────────────────────────

		/** How long to wait between window-settle polls. */
		const WINDOW_POLL_MS = 40;
		/** How many settle polls to wait for the page the Session face already fetched. */
		const WINDOW_POLL_LIMIT = 30;
		/** How many backward pages to request when the turn's own start is unknown. */
		const WINDOW_PAGE_ATTEMPTS = 20;

		/**
		 * Resolve after a delay.
		 * @param milliseconds - how long to wait.
		 * @returns a promise resolving after the delay.
		 */
		function delay(milliseconds) {
			return new Promise((resolve) => {
				window.setTimeout(resolve, milliseconds);
			});
		}

		/**
		 * Count the tool-call nodes a turn currently holds — the settle signal.
		 * @param snapshot - Chat snapshot.
		 * @param turn - owning turn.
		 * @returns how many of the turn's node keys resolve to a tool-call node.
		 */
		function turnToolNodeCount(snapshot, turn) {
			const keys = snapshot?.locations?.getTurn(turn);
			if (!Array.isArray(keys)) return 0;
			let count = 0;
			for (const key of keys) {
				const node = snapshot.nodes.get(key);
				if (node !== undefined && node.kind === "tool-call") count += 1;
			}
			return count;
		}

		/**
		 * Page the Session window back until it covers a turn's own start.
		 *
		 * The Chat target loads a bounded window — the last `PAGE_MESSAGES`
		 * messages — so a long turn's early calls can sit outside it. Their nodes
		 * then exist with no call head and no result metadata, so nothing can be
		 * reported for them however the aggregation is written. The Session face
		 * owns the cure: `loadThrough(seq)` pages backwards until the window
		 * covers `seq`. The timeline outline usually still names the turn's start
		 * even while its events are outside the window; when it does not, this
		 * pages back one batch at a time instead.
		 *
		 * Best effort by construction: every failure path returns, so the caller
		 * reports whatever the window holds rather than nothing.
		 * @param sessions - the client Sessions face.
		 * @param sessionId - the Session being viewed.
		 * @param turn - the turn to cover.
		 * @param readSnapshot - reader for the latest Chat snapshot.
		 */
		async function coverTurn(sessions, sessionId, turn, readSnapshot) {
			try {
				// `scope(id)` only answers for an already-materialized scope. The
				// materializing resolver answers for the mounted session too (it is
				// already in the map, so nothing new is created), and both return
				// the tagged Agent context `sessionOf` reads.
				let scope;
				if (typeof sessions.resolveAgentScope === "function") scope = sessions.resolveAgentScope(sessionId);
				if (scope === undefined && typeof sessions.scope === "function") scope = sessions.scope(sessionId);
				const face = scope === undefined ? undefined : sessions.sessionOf(scope);
				if (face === undefined || typeof face.loadThrough !== "function") return;
				const startSeqOf = () => {
					const start = readSnapshot()?.timeline?.turns?.get(turn)?.start;
					return start === undefined ? undefined : start.seq;
				};
				let startSeq = startSeqOf();
				let previous = -1;
				for (let attempt = 0; startSeq === undefined && attempt < WINDOW_PAGE_ATTEMPTS; attempt += 1) {
					const count = turnToolNodeCount(readSnapshot(), turn);
					// No new tool nodes means the window cannot grow further: stop
					// rather than page forever against an exhausted history.
					if (count === previous) break;
					previous = count;
					await face.loadOlder();
					startSeq = startSeqOf();
				}
				if (typeof startSeq !== "number") return;
				await face.loadThrough(startSeq);
				// Let the fetched page reach the projection and the view: the count
				// stops changing once the turn is whole, or once nothing more comes.
				previous = -1;
				for (let poll = 0; poll < WINDOW_POLL_LIMIT; poll += 1) {
					const count = turnToolNodeCount(readSnapshot(), turn);
					if (count > 0 && count === previous) return;
					previous = count;
					await delay(WINDOW_POLL_MS);
				}
			} catch (error) {
				console.error("[dsh-turn-diff] could not page the turn into the window", error);
			}
		}

		// ── styles ──────────────────────────────────────────────────────────

		const css = {
			root: "dshTurnDiff_root",
			head: "dshTurnDiff_head",
			turn: "dshTurnDiff_turn",
			summary: "dshTurnDiff_summary",
			file: "dshTurnDiff_file",
			fileHead: "dshTurnDiff_fileHead",
			chevron: "dshTurnDiff_chevron",
			expandAll: "dshTurnDiff_expandAll",
			filePath: "dshTurnDiff_filePath",
			fileStat: "dshTurnDiff_fileStat",
			diff: "dshTurnDiff_diff",
			note: "dshTurnDiff_note",
			warn: "dshTurnDiff_warn",
			empty: "dshTurnDiff_empty",
			button: "dshTurnDiff_button"
		};

		const stylesheet = `
.dshTurnDiff_root{display:flex;flex-direction:column;gap:12px;padding:10px 12px;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary)}
.dshTurnDiff_head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.dshTurnDiff_turn{font-weight:500}
.dshTurnDiff_summary{color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-mono,monospace);font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px)}
.dshTurnDiff_file{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-base)}
.dshTurnDiff_fileHead{display:flex;align-items:center;gap:6px;width:100%;padding:6px 10px;background:var(--dsw-alias-bg-layer-2);border:none;text-align:left;cursor:pointer;font:inherit;color:inherit}
.dshTurnDiff_fileHead:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshTurnDiff_file[data-open] .dshTurnDiff_fileHead{border-bottom:1px solid var(--dsw-alias-border-l2)}
.dshTurnDiff_chevron{display:inline-flex;flex:none;align-items:center;color:var(--dsw-alias-label-tertiary)}
.dshTurnDiff_expandAll{margin-left:auto;height:22px;padding:0 8px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px)}
.dshTurnDiff_expandAll:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshTurnDiff_filePath{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--dsw-font-mono,monospace)}
.dshTurnDiff_fileStat{flex:none;color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-mono,monospace);font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px)}
.dshTurnDiff_diff{overflow:auto}
.dshTurnDiff_note{margin:0;color:var(--dsw-alias-label-tertiary);font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px)}
.dshTurnDiff_warn{margin:0;padding:6px 8px;border:1px solid var(--dsw-alias-state-warn-primary);border-radius:6px;color:var(--dsw-alias-state-warn-primary);font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px)}
.dshTurnDiff_empty{padding:16px 12px;color:var(--dsw-alias-label-tertiary)}
.dshTurnDiff_button{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 8px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:var(--dsh-content-font-size-secondary,13px)}
.dshTurnDiff_button:hover{background:var(--dsw-alias-interactive-bg-hover)}
`;

		if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css="${TAB_ID}"]`) === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = TAB_ID;
			tag.dataset.pluginCss = TAB_ID;
			tag.textContent = stylesheet;
			document.head.appendChild(tag);
		}

		// ── components ──────────────────────────────────────────────────────

		/**
		 * Build the `DiffBlock` copy for one locale revision.
		 * @param t - this plugin's namespace-bound translate.
		 * @returns the primitive's labels.
		 */
		function diffLabels(t) {
			return {
				copy: t("copy"),
				copied: t("copied"),
				collapse: t("collapse"),
				collapseAria: t("collapseAria"),
				expand: (count) => t("expand", { count }),
				expandAria: (count) => t("expandAria", { count }),
				files: (count) => t(count === 1 ? "files.one" : "files.other", { count })
			};
		}

		/**
		 * The conversation entry: a ghost button on a turn's closing assistant
		 * message, present only when that turn changed files.
		 * @param props - composed slot props.
		 * @returns the button, or null.
		 */
		function TurnDiffAction(props) {
			if (typeof props.useChat !== "function") return null;
			return h(TurnDiffActionSubscribed, props);
		}

		/**
		 * The subscribed half, split out so the store hooks are unconditional.
		 * @param props - composed slot props with the Chat selector hook.
		 * @returns the button, or null.
		 */
		function TurnDiffActionSubscribed({ messageId, useChat, openDiff, coverWindow, t }) {
			const signature = useChat((snapshot) => signatureOf(snapshot, messageId));
			const snapshot = useChat((current) => current);
			const snapshotRef = react.useRef(snapshot);
			snapshotRef.current = snapshot;
			const [busy, setBusy] = react.useState(false);
			if (typeof signature !== "string") return null;
			const summary = summaryOf(signature);
			const onClick = async () => {
				if (typeof openDiff !== "function" || busy) return;
				setBusy(true);
				try {
					// A long turn's earliest calls can sit outside the loaded window;
					// page them in before aggregating, or the page under-reports.
					if (typeof coverWindow === "function") await coverWindow(summary.turn, () => snapshotRef.current);
					const data = turnDataFor(snapshotRef.current ?? snapshot, summary.turn);
					if (data.files.length === 0) return;
					openDiff(data);
				} finally {
					setBusy(false);
				}
			};
			return h("button", {
				type: "button",
				className: css.button,
				disabled: busy,
				title: summary.complete
					? t("action.title", {
							files: summary.files,
							added: summary.added,
							removed: summary.removed
						})
					: t("action.titlePartial"),
				onClick
			}, [
				ICON_ENTRY === null ? null : h(ICON_ENTRY, { key: "icon" }),
				h("span", { key: "label" }, busy ? t("action.loading") : t("action.label")),
				h("span", { key: "stat", className: css.summary },
					summary.complete ? `+${summary.added} −${summary.removed}` : "…")
			]);
		}

		/**
		 * The page body: the tab's information hook and the handed-over aggregate.
		 *
		 * The page itself is a separate component keyed by the hand-off token, so
		 * opening another turn remounts it and drops the previous expansion state
		 * instead of leaving stale paths expanded.
		 * @param props - composed slot props with the tab-information hook.
		 * @returns the diff page.
		 */
		function TurnDiffBody({ useTabInfo, t }) {
			const { tab } = useTabInfo();
			const labels = react.useMemo(() => diffLabels(t), [t]);
			const params = tab.navigation?.params;
			const token = params !== null && typeof params === "object" ? params.token : undefined;
			const data = typeof token === "string" ? stash.get(token) : undefined;
			if (data === undefined) return h("div", { className: css.empty }, t("body.missing"));
			if (data.files.length === 0) return h("div", { className: css.empty }, t("body.empty"));
			return h(TurnDiffPage, { key: typeof token === "string" ? token : "none", data, labels, t });
		}

		/**
		 * The diff page proper: one collapsed-by-default section per file, each
		 * header toggling its own hunks. A one-file turn opens that file, since a
		 * single click to reveal the only thing on the page would be pure ceremony.
		 * @param props - the aggregate, the primitive's labels, and the translate.
		 * @returns the page.
		 */
		function TurnDiffPage({ data, labels, t }) {
			const [open, setOpen] = react.useState(() => new Set(data.files.length === 1 ? [data.files[0].path] : []));
			const toggle = (path) => {
				setOpen((current) => {
					const next = new Set(current);
					if (next.has(path)) next.delete(path);
					else next.add(path);
					return next;
				});
			};
			const allOpen = data.files.length > 0 && open.size >= data.files.length;
			const toggleAll = () => {
				setOpen(allOpen ? new Set() : new Set(data.files.map((file) => file.path)));
			};
			return h("div", { className: css.root }, [
				h("header", { className: css.head, key: "head" }, [
					h("span", { className: css.turn, key: "turn" }, t("body.turn", { turn: data.turn })),
					h("span", { className: css.summary, key: "summary" }, t("body.summary", {
						files: data.files.length,
						added: data.added,
						removed: data.removed
					})),
					h("button", {
						type: "button",
						className: css.expandAll,
						key: "all",
						onClick: toggleAll
					}, allOpen ? t("body.collapseAll") : t("body.expandAll"))
				]),
				...data.files.map((file) => {
					const isOpen = open.has(file.path);
					return h("section", {
						className: css.file,
						key: file.path,
						...(isOpen ? { "data-open": "" } : {})
					}, [
						h("button", {
							type: "button",
							className: css.fileHead,
							key: "head",
							"aria-expanded": isOpen,
							onClick: () => toggle(file.path)
						}, [
							h("span", { className: css.chevron, key: "chevron" },
								isOpen
									? (ICON_OPEN === null ? "▾" : h(ICON_OPEN))
									: (ICON_CLOSED === null ? "▸" : h(ICON_CLOSED))),
							h("span", { className: css.filePath, title: file.path, key: "path" }, file.path),
							h("span", { className: css.fileStat, key: "stat" },
								`+${file.added} −${file.removed} · ${t("body.hunks", { count: file.diffs.length })}`)
						]),
						isOpen && h(primitives.DiffBlock, {
							key: "diff",
							diffs: file.diffs,
							labels,
							maxLines: Infinity,
							className: css.diff
						})
					]);
				}),
				h("p", { className: css.note, key: "note" }, t("body.note")),
				(data.stats?.headless ?? 0) > 0 &&
					h("p", { className: css.warn, key: "partial" }, t("body.partial", { count: data.stats.headless }))
			]);
		}

		// ── plugin ──────────────────────────────────────────────────────────

		/** Required client services: slots, copy, both Sidebar faces, and the Session objects. */
		const inject = ["slots", "locale", "sidebarRight", "sidebarRightTabs", "sessions"];

		/**
		 * Client plugin body: register the dictionaries, the page type with its
		 * body, and the conversation entry that opens it.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "turn-diff: dictionaries");
			ctx.effect(() => ctx.sidebarRightTabs.register({
				id: TAB_ID,
				kind: KIND,
				title: () => t("tab.title"),
				guide: [{
					order: 60,
					title: () => t("guide.title"),
					description: () => t("guide.description")
				}]
			}), "turn-diff: tab type");
			ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
				name: "sidebar.right.pane.tab",
				key: TAB_ID,
				locale: NS
			}, TurnDiffBody));
			ctx.slots.inject("conversation.chat.assistant-actions", () => ctx.slots.register({
				name: "conversation.chat.assistant-actions",
				id: KIND,
				order: 40,
				locale: NS,
				inject: (sessionId) => ({
					coverWindow: (turn, readSnapshot) => coverTurn(ctx.sessions, sessionId, turn, readSnapshot),
					openDiff: (data) => {
						const token = stashPut(data);
						try {
							ctx.sidebarRight.openTab(KIND, { params: { token } });
						} catch (error) {
							console.error("[dsh-turn-diff] could not open the diff tab", error);
						}
					}
				})
			}, TurnDiffAction));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
