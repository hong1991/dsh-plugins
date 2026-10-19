/**
 * dsh-session-find, browser half.
 *
 * One read-only surface: a Ctrl+F style find bar above the composer that
 * searches the text the current conversation has already rendered.
 *
 * Why the rendered transcript instead of the session log:
 *
 * - The transcript already excludes what the user asked to skip. Reasoning
 *   blocks are not rendered by the Conversation layer, so a search over the DOM
 *   cannot report chain-of-thought text in the first place — no block-type
 *   filter to keep in sync with the Host's own index.
 * - A find bar must highlight and reveal. Matches become `Range`s over live text
 *   nodes, so the CSS Custom Highlight API paints them and the scroll container
 *   centres the current one without any Host round trip, and without an
 *   extension point the Conversation does not expose (chat nodes carry no
 *   per-message DOM anchor).
 *
 * Two consequences are surfaced in the UI rather than hidden: only loaded
 * history is searchable, so the bar offers to page in earlier turns (through the
 * retained Session's own `loadOlder()`), and matching is literal and
 * case-insensitive within one text node, which is what a Chinese substring query
 * needs — the shipped Host index is FTS5 `unicode61`, token-based, and cannot
 * match Chinese substrings at all.
 *
 * Integration points, both additive:
 *
 * - `conversation.input.dock` (a session-scoped `list` slot) renders the bar and
 *   hands it `sessionId`, `useSession`, and the locale-bound `t`.
 * - `ctx.shortcuts` binds the bar to the platform's primary modifier + F on
 *   Desktop. Registration is attempted defensively: a reserved or conflicting
 *   default must not take the whole plugin down, and the bar stays reachable
 *   from its own button.
 *
 * @module dsh-session-find/client
 */
window.__ModuleLoader__.load({
	id: "dsh-session-find",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const h = react.createElement;

		/** Dictionary namespace owned by this plugin. */
		const NS = "sessionFind";
		/** This plugin's cell in `conversation.input.dock`. */
		const DOCK_ID = "find";
		/** This plugin's stylesheet owner id, tagged so the module loader can track it. */
		const STYLE_ID = "dsh-session-find";
		/** Highlight registries, and the `::highlight()` rules that paint them. */
		const HIGHLIGHT_ALL = "dsh-session-find-all";
		const HIGHLIGHT_CURRENT = "dsh-session-find-current";
		/** Upper bounds that keep one pathological query from freezing the page. */
		const MAX_MATCHES = 4000;
		const MAX_HIGHLIGHT_RANGES = 1500;
		/** History pages one automatic backwards scan may load before it stops. */
		const MAX_SCAN_PAGES = 12;
		/** Frames to wait for a prepended page to reach the DOM before giving up. */
		const GROWTH_FRAME_LIMIT = 6;
		/** Debounce for typing, and for transcript mutations, in milliseconds. */
		const TYPING_DELAY_MS = 120;
		const MUTATION_DELAY_MS = 240;

		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"bar.placeholder": "在对话中查找…",
			"bar.label": "在对话中查找",
			"bar.openTitle": "在对话中查找（Ctrl+F）",
			"bar.close": "关闭查找",
			"bar.prev": "上一个匹配",
			"bar.next": "下一个匹配",
			"bar.count": "第 {current} / {total} 个匹配",
			"bar.countCapped": "第 {current} / {total}+ 个匹配",
			"bar.none": "无匹配",
			"bar.idle": "输入要查找的文字",
			"bar.loadEarlier": "加载更早的历史并继续查找",
			"bar.earlierShort": "更早",
			"bar.loading": "正在加载…",
			"bar.searchingEarlier": "正在搜索更早的历史…",
			"bar.noneScanned": "无匹配（已向前搜索 {pages} 页）",
			"bar.hasMore": "更早的历史尚未载入，可能还有匹配。",
			"bar.noScroller": "找不到可搜索的对话区域。",
			"bar.loadFailed": "加载更早历史失败：{message}",
			"shortcut.label": "在对话中查找",
			"shortcut.noSession": "当前没有打开的对话"
		};

		/** English dictionary (same key set). */
		const en = {
			"bar.placeholder": "Find in conversation…",
			"bar.label": "Find in conversation",
			"bar.openTitle": "Find in conversation (Ctrl+F)",
			"bar.close": "Close find",
			"bar.prev": "Previous match",
			"bar.next": "Next match",
			"bar.count": "Match {current} of {total}",
			"bar.countCapped": "Match {current} of {total}+",
			"bar.none": "No matches",
			"bar.idle": "Type text to find",
			"bar.loadEarlier": "Load earlier history and keep searching",
			"bar.earlierShort": "Earlier",
			"bar.loading": "Loading…",
			"bar.searchingEarlier": "Searching earlier history…",
			"bar.noneScanned": "No matches (searched {pages} earlier pages)",
			"bar.hasMore": "Earlier history is not loaded yet, so matches may remain.",
			"bar.noScroller": "No searchable conversation area found.",
			"bar.loadFailed": "Could not load earlier history: {message}",
			"shortcut.label": "Find in conversation",
			"shortcut.noSession": "No conversation is open"
		};

		// ── styles ──────────────────────────────────────────────────────────
		// Only `--dsw-alias-*` theme tokens and two literal rgba fallbacks: a
		// renamed token degrades the look but never breaks rendering, and the
		// highlight rules keep a visible colour if `color-mix()` is unavailable.

		const stylesheet = `
.dshSessionFind_root{display:flex;align-items:center;gap:6px;width:100%;padding:0 0 8px;font-size:var(--dsh-content-font-size-secondary,13px);color:var(--dsw-alias-label-primary)}
.dshSessionFind_trigger{display:inline-flex;flex:none;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit}
.dshSessionFind_trigger:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshSessionFind_trigger[data-open]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshSessionFind_card{display:flex;align-items:center;gap:4px;width:100%;height:34px;padding:0 4px 0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2)}
.dshSessionFind_input{flex:1 1 auto;min-width:0;height:28px;padding:0 4px;border:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--dsh-content-font-size-secondary,13px);outline:none}
.dshSessionFind_input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dshSessionFind_count{flex:none;padding:0 4px;color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-mono,monospace);font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);white-space:nowrap}
.dshSessionFind_count[data-state=empty]{color:var(--dsw-alias-state-warn-primary)}
.dshSessionFind_sep{flex:none;width:1px;height:14px;margin:0 2px;background:var(--dsw-alias-border-l2)}
.dshSessionFind_button{display:inline-flex;flex:none;align-items:center;justify-content:center;height:24px;min-width:24px;padding:0 5px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:var(--dsh-content-font-size-secondary,13px)}
.dshSessionFind_button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshSessionFind_button:disabled{opacity:.45;cursor:default}
.dshSessionFind_trigger:focus-visible,.dshSessionFind_button:focus-visible{outline:2px solid currentColor;outline-offset:1px}
.dshSessionFind_warn{width:100%;margin:0 0 4px;color:var(--dsw-alias-state-warn-primary);font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px)}
::highlight(dsh-session-find-all){background-color:rgba(255,196,0,.32);color:inherit;background-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 28%, transparent)}
::highlight(dsh-session-find-current){background-color:rgba(255,145,0,.72);color:inherit;background-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 70%, transparent)}
`;

		// The module loader claims every untagged `<style>` at materialization and
		// removes the tags it owns when the plugin is replaced, so this sheet is
		// injected here — tagged, at materialization — rather than rendered by
		// React. A React-rendered tag would be claimed by the next plugin loaded
		// and deleted along with it.
		if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = STYLE_ID;
			tag.dataset.pluginCss = STYLE_ID;
			tag.textContent = stylesheet;
			document.head.appendChild(tag);
		}

		// ── find state ──────────────────────────────────────────────────────
		// The shortcut and the bar are separate registrations that must agree on
		// one value, so the request to open — plus the focus counter that makes a
		// repeated Ctrl+F re-focus the field — lives in this tiny store.

		function createFindState() {
			let state = { open: false, query: "", focusToken: 0 };
			const listeners = new Set();
			let mounted = 0;
			const emit = () => {
				for (const listener of [...listeners]) listener();
			};
			return {
				subscribe(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				getSnapshot() {
					return state;
				},
				/** Count live bars so the shortcut can report "no conversation". */
				attach() {
					mounted += 1;
					return () => {
						mounted -= 1;
					};
				},
				isMounted() {
					return mounted > 0;
				},
				open() {
					state = { ...state, open: true, focusToken: state.focusToken + 1 };
					emit();
				},
				close() {
					state = { ...state, open: false };
					emit();
				},
				setQuery(query) {
					state = { ...state, query };
					emit();
				}
			};
		}

		const findState = createFindState();

		/**
		 * Subscribe to the store, using the React 18 hook when it exists.
		 * @returns the current store value.
		 */
		function useFindState() {
			if (typeof react.useSyncExternalStore === "function") {
				return react.useSyncExternalStore(findState.subscribe, findState.getSnapshot);
			}
			const [value, setValue] = react.useState(findState.getSnapshot);
			react.useEffect(() => findState.subscribe(() => setValue(findState.getSnapshot())), []);
			return value;
		}

		// ── rendered-text search ────────────────────────────────────────────

		/**
		 * Score one element as the transcript's scroll container.
		 * @param element - candidate element.
		 * @returns its scroll height when it actually scrolls vertically, else 0.
		 */
		function verticalScrollScore(element) {
			const scrollHeight = element.scrollHeight;
			if (typeof scrollHeight !== "number" || scrollHeight <= element.clientHeight + 32) return 0;
			const overflowY = window.getComputedStyle(element).overflowY;
			if (overflowY !== "auto" && overflowY !== "scroll" && overflowY !== "overlay") return 0;
			return scrollHeight;
		}

		/**
		 * Walk up to the conversation body that owns this plugin's mount point.
		 * @param mount - this plugin's root element.
		 * @returns the `data-conversation-content` element, or null.
		 */
		function findConversationContent(mount) {
			let node = mount.parentElement;
			while (node !== null && node !== document.body) {
				if (node.hasAttribute("data-conversation-content")) return node;
				node = node.parentElement;
			}
			return null;
		}

		/**
		 * Find the conversation's scroll container from this plugin's own node.
		 *
		 * The layout marks its scrollport: `data-conversation-content` is the
		 * body and `data-conversation-scroll` its direct scrolling child — the same
		 * pair the platform itself resolves for its own wheel handling. Those
		 * attributes are semantic (the input scope reads `data-conversation-region`
		 * likewise), so preferring them is stronger than guessing at the largest
		 * scrolling descendant, which on a short conversation can pick another
		 * panel's scroller. The generic walk stays as the fallback for a build
		 * without the markers.
		 * @param mount - this plugin's root element.
		 * @returns the scroll container, or null when none is found.
		 */
		function findScrollContainer(mount) {
			const content = findConversationContent(mount);
			if (content !== null) {
				const scroller = content.querySelector(":scope > [data-conversation-scroll]") ?? content.querySelector("[data-conversation-scroll]");
				if (scroller !== null) return scroller;
			}
			let node = mount.parentElement;
			while (node !== null && node !== document.body) {
				let best = null;
				let bestScore = 0;
				for (const element of node.querySelectorAll("*")) {
					if (element === mount || element.contains(mount)) continue;
					const score = verticalScrollScore(element);
					if (score > bestScore) {
						best = element;
						bestScore = score;
					}
				}
				if (best !== null && bestScore > 400) return best;
				node = node.parentElement;
			}
			return null;
		}

		/**
		 * Collect literal, case-insensitive matches over one container's text.
		 * @param container - the scroll container to walk.
		 * @param mount - this plugin's root, whose own subtree is skipped.
		 * @param query - the raw query; whitespace-only queries match nothing.
		 * @returns matches in document order, each with its text node and offsets.
		 */
		function collectMatches(container, mount, query) {
			if (query === "" || query.trim() === "") return [];
			const needle = query.toLowerCase();
			const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
				acceptNode(node) {
					const text = node.nodeValue;
					if (text === null || text.trim() === "") return NodeFilter.FILTER_REJECT;
					const parent = node.parentElement;
					if (parent === null) return NodeFilter.FILTER_REJECT;
					if (parent === mount || parent.contains(mount)) return NodeFilter.FILTER_REJECT;
					// The scrollport also hosts the composer, whose editor is a
					// contenteditable: its draft and controls are ordinary text nodes.
					// A conversation search must not match what the user is typing.
					if (parent.closest('[data-conversation-region="composer"], [data-composer-seat]') !== null) return NodeFilter.FILTER_REJECT;
					if (parent.closest("[hidden],[aria-hidden='true']") !== null) return NodeFilter.FILTER_REJECT;
					const tag = parent.tagName;
					if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return NodeFilter.FILTER_REJECT;
					return NodeFilter.FILTER_ACCEPT;
				}
			});
			const matches = [];
			let node = walker.nextNode();
			while (node !== null) {
				const text = node.nodeValue.toLowerCase();
				let from = 0;
				for (;;) {
					const at = text.indexOf(needle, from);
					if (at === -1) break;
					matches.push({ node, start: at, end: at + needle.length });
					if (matches.length >= MAX_MATCHES) return matches;
					from = at + Math.max(1, needle.length);
				}
				node = walker.nextNode();
			}
			return matches;
		}

		/**
		 * Turn one match into a DOM Range for the highlight registries.
		 * @param match - a match from {@link collectMatches}.
		 * @returns the range covering it.
		 */
		function rangeOf(match) {
			const range = document.createRange();
			range.setStart(match.node, match.start);
			range.setEnd(match.node, match.end);
			return range;
		}

		/**
		 * Paint the matches through the CSS Custom Highlight API.
		 * @param matches - matches from {@link collectMatches}.
		 * @param current - index of the current match, or -1.
		 */
		function paintHighlights(matches, current) {
			if (typeof CSS === "undefined" || typeof Highlight !== "function" || CSS.highlights === undefined) return;
			const ranges = [];
			for (const match of matches.slice(0, MAX_HIGHLIGHT_RANGES)) ranges.push(rangeOf(match));
			if (ranges.length === 0) {
				CSS.highlights.delete(HIGHLIGHT_ALL);
			} else {
				CSS.highlights.set(HIGHLIGHT_ALL, new Highlight(...ranges));
			}
			// The current match is painted from its own range: the bulk highlight's
			// cap must never cost a match its marker.
			const active = current >= 0 && current < matches.length ? rangeOf(matches[current]) : null;
			if (active === null) {
				CSS.highlights.delete(HIGHLIGHT_CURRENT);
			} else {
				CSS.highlights.set(HIGHLIGHT_CURRENT, new Highlight(active));
			}
		}

		/** Drop both highlight registries; safe on every teardown path. */
		function clearHighlights() {
			if (typeof CSS === "undefined" || CSS.highlights === undefined) return;
			CSS.highlights.delete(HIGHLIGHT_ALL);
			CSS.highlights.delete(HIGHLIGHT_CURRENT);
		}

		/**
		 * Centre one match in its scroll container.
		 * @param container - the scroll container found for this conversation.
		 * @param match - the match to reveal.
		 */
		function revealMatch(container, match) {
			const element = match.node.parentElement;
			if (element === null) return;
			const box = container.getBoundingClientRect();
			const rect = element.getBoundingClientRect();
			if (rect.top >= box.top && rect.bottom <= box.bottom) return;
			container.scrollTop += rect.top - box.top - (container.clientHeight - rect.height) / 2;
		}

		/**
		 * Resolve after the next paint, when a prepended history page is in the DOM.
		 * @returns a promise settled on the next frame (or a timer fallback).
		 */
		function nextFrame() {
			return new Promise((resolve) => {
				if (typeof window.requestAnimationFrame === "function") {
					window.requestAnimationFrame(() => {
						window.setTimeout(resolve, 0);
					});
				} else {
					window.setTimeout(resolve, 16);
				}
			});
		}

		/**
		 * Wait until a page load has actually grown the scrollport.
		 * @param container - the conversation scrollport, or null.
		 * @param before - its scroll height before the load.
		 * @returns whether the DOM grew within the frame budget.
		 */
		async function waitForGrowth(container, before) {
			if (container === null) return false;
			for (let frame = 0; frame < GROWTH_FRAME_LIMIT; frame += 1) {
				await nextFrame();
				if (container.scrollHeight > before) return true;
			}
			return false;
		}

		// ── components ──────────────────────────────────────────────────────

		/** A magnifier drawn from currentColor, independent of icon-set drift. */
		function SearchGlyph() {
			return h(
				"svg",
				{ width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
				h("circle", { cx: 7, cy: 7, r: 4.25, stroke: "currentColor", strokeWidth: 1.4 }),
				h("path", { d: "M10.2 10.2 14 14", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" })
			);
		}

		/**
		 * A chevron for the previous/next controls.
		 * @param props - `up` selects the upward glyph.
		 * @returns the glyph element.
		 */
		function ChevronGlyph({ up }) {
			return h(
				"svg",
				{ width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
				h("path", {
					d: up ? "M4 9.5 8 5.5l4 4" : "M4 6.5l4 4 4-4",
					stroke: "currentColor",
					strokeWidth: 1.5,
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			);
		}

		/** The close glyph, matching the composer's 14px icon rhythm. */
		function CloseGlyph() {
			return h(
				"svg",
				{ width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
				h("path", { d: "M4.5 4.5l7 7M11.5 4.5l-7 7", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" })
			);
		}

		/**
		 * The compact trigger in the composer's tool row. It shares the find store
		 * with the bar, so the two agree and the trigger toggles the bar.
		 * @param props - composed slot props with the translate.
		 * @returns the icon button.
		 */
		function FindTrigger({ t }) {
			const store = useFindState();
			return h(
				"button",
				{
					type: "button",
					className: "dshSessionFind_trigger",
					title: t("bar.openTitle"),
					"aria-label": t("bar.label"),
					"aria-pressed": store.open,
					...(store.open ? { "data-open": "" } : {}),
					onClick: () => {
						if (store.open) findState.close();
						else findState.open();
					}
				},
				h(SearchGlyph, { key: "icon" })
			);
		}

		/**
		 * The bar. Split from its subscribed half so store hooks stay
		 * unconditional across the closed and open states.
		 * @param props - composed slot props.
		 * @returns the dock entry.
		 */
		function FindDock(props) {
			if (typeof props.useSession !== "function") return null;
			return h(FindDockSubscribed, props);
		}

		/**
		 * The subscribed half: search state, highlight lifetime, and paging.
		 * @param props - composed slot props with `sessionId`, `useSession`, `t`.
		 * @returns the closed button or the open find card.
		 */
		function FindDockSubscribed({ sessionId, useSession, sessions, t }) {
			const store = useFindState();
			const hasMore = useSession((snapshot) => snapshot.hasMore === true);
			const rootRef = react.useRef(null);
			const inputRef = react.useRef(null);
			const containerRef = react.useRef(null);
			const matchesRef = react.useRef([]);
			const indexRef = react.useRef(-1);
			/** The live search, so the backwards scan can re-run it after a page. */
			const runSearchRef = react.useRef(null);
			/** The live scan, so the search can start one without an effect cycle. */
			const scanRef = react.useRef(null);
			/** The query whose automatic scan already ran; null re-arms it. */
			const autoScanRef = react.useRef(null);
			/** Invalidates an in-flight scan when the bar closes or the query moves. */
			const scanTokenRef = react.useRef(0);
			/** Guards against two scans at once, across renders. */
			const pagingRef = react.useRef(false);
			const hasMoreRef = react.useRef(hasMore);
			hasMoreRef.current = hasMore;
			const queryRef = react.useRef(store.query);
			queryRef.current = store.query;
			const [result, setResult] = react.useState({ count: 0, index: -1, missing: false, capped: false });
			const [paging, setPaging] = react.useState(false);
			const [pagingError, setPagingError] = react.useState(null);
			const [scanLimited, setScanLimited] = react.useState(false);

			// One shared reference makes `loadOlder()` reachable; a profile where
			// retention is unavailable simply loses the paging button.
			const reference = react.useMemo(() => {
				if (sessions === undefined || sessions === null) return null;
				try {
					return sessions.retain(sessionId, { source: "controllerOperation" });
				} catch (error) {
					console.warn("[dsh-session-find] could not retain the session for paging", error);
					return null;
				}
			}, [sessions, sessionId]);

			react.useEffect(() => findState.attach(), []);
			react.useEffect(
				() => () => {
					clearHighlights();
				},
				[]
			);
			react.useEffect(
				() => () => {
					if (reference !== null) reference.release();
				},
				[reference]
			);

			// Focus on open, and again on every repeated Ctrl+F.
			react.useEffect(() => {
				if (!store.open) return;
				const input = inputRef.current;
				if (input === null) return;
				input.focus();
				input.select();
			}, [store.open, store.focusToken]);

			// A close or a query change invalidates a scan already in flight and
			// re-arms the automatic backwards search for the new query.
			react.useEffect(() => {
				scanTokenRef.current += 1;
				if (!store.open || store.query.trim() === "") autoScanRef.current = null;
				setScanLimited(false);
				return () => {
					scanTokenRef.current += 1;
				};
			}, [store.open, store.query]);

			// The search itself: re-run on query, on paging, and on transcript
			// mutations (streaming renders and history pages change the text).
			react.useEffect(() => {
				if (!store.open) {
					clearHighlights();
					return;
				}
				const query = store.query;
				let cancelled = false;
				let mutationTimer = 0;
				const observer = new MutationObserver(() => {
					window.clearTimeout(mutationTimer);
					mutationTimer = window.setTimeout(run, MUTATION_DELAY_MS);
				});
				const run = () => {
					if (cancelled) return;
					const mount = rootRef.current;
					if (mount === null) return;
					let container = containerRef.current;
					if (container === null || !container.isConnected) {
						container = findScrollContainer(mount);
						containerRef.current = container;
					}
					if (container === null) {
						matchesRef.current = [];
						setResult({ count: 0, index: -1, missing: true, capped: false });
						return;
					}
					// The container is resolved here, after the typing delay, so the
					// observer is aimed from this callback. In the effect body on the
					// first open the ref is still null, which is why the first search
					// used to stay blind to streaming and history loads.
					observer.disconnect();
					observer.observe(container, { childList: true, subtree: true, characterData: true });
					const matches = collectMatches(container, mount, query);
					matchesRef.current = matches;
					// Reaching the cap means the walker stopped early, so the count is
					// a lower bound and the status shows it as one.
					const capped = matches.length >= MAX_MATCHES;
					// A ref, not the captured state: a mutation-triggered re-run
					// must keep the match the user is currently on.
					const index = matches.length === 0 ? -1 : Math.min(Math.max(indexRef.current, 0), matches.length - 1);
					indexRef.current = index;
					setResult({ count: matches.length, index, missing: false, capped });
					paintHighlights(matches, index);
					if (index >= 0) revealMatch(container, matches[index]);
					if (matches.length > 0) setScanLimited(false);
					// A query the loaded window cannot answer may still exist earlier in
					// the session: page backwards until it is found, history ends, or the
					// scan budget is spent. `autoScanRef` makes this once per query.
					if (
						matches.length === 0 &&
						query.trim() !== "" &&
						hasMoreRef.current &&
						!pagingRef.current &&
						autoScanRef.current !== query
					) {
						autoScanRef.current = query;
						void scanRef.current?.(query, MAX_SCAN_PAGES);
					}
				};
				runSearchRef.current = run;
				const timer = window.setTimeout(run, TYPING_DELAY_MS);
				return () => {
					cancelled = true;
					window.clearTimeout(timer);
					window.clearTimeout(mutationTimer);
					observer.disconnect();
					if (runSearchRef.current === run) runSearchRef.current = null;
				};
			}, [store.open, store.query]);

			/**
			 * Page the retained Session's window backwards and re-search after each
			 * page, stopping at the first page with a match, the start of history, or
			 * the caller's page budget.
			 * @param query - the query this scan belongs to.
			 * @param maxPages - how many pages this call may load.
			 * @returns a promise settled after the attempt.
			 */
			const scanEarlier = async (query, maxPages) => {
				if (reference === null || pagingRef.current) return;
				pagingRef.current = true;
				const token = scanTokenRef.current;
				setPaging(true);
				setPagingError(null);
				setScanLimited(false);
				try {
					await reference.ready;
					const face = reference.binding.session;
					for (let page = 0; page < maxPages; page += 1) {
						if (token !== scanTokenRef.current || queryRef.current !== query || !hasMoreRef.current) break;
						const container = containerRef.current;
						const before = container === null ? 0 : container.scrollHeight;
						await face.loadOlder();
						const grew = await waitForGrowth(container, before);
						if (token !== scanTokenRef.current || queryRef.current !== query) return;
						runSearchRef.current?.();
						if (matchesRef.current.length > 0 || !grew) break;
					}
					// Stopping on the budget (not on the start of history) means an
					// earlier page may still hold the query; say so instead of "none".
					if (
						token === scanTokenRef.current &&
						matchesRef.current.length === 0 &&
						hasMoreRef.current &&
						maxPages > 1
					) {
						setScanLimited(true);
					}
				} catch (error) {
					setPagingError(error instanceof Error ? error.message : String(error));
				} finally {
					pagingRef.current = false;
					setPaging(false);
					// A query change aborted this scan; let the new query re-evaluate now.
					if (token !== scanTokenRef.current) runSearchRef.current?.();
				}
			};
			scanRef.current = scanEarlier;

			/**
			 * Move to another match and reveal it.
			 * @param step - +1 for the next match, -1 for the previous one.
			 */
			const move = (step) => {
				const matches = matchesRef.current;
				if (matches.length === 0) return;
				// The ref, not the rendered state: two moves dispatched from one task
				// must each advance the cursor.
				const currentIndex = Math.min(Math.max(indexRef.current, 0), matches.length - 1);
				const next = (currentIndex + step + matches.length) % matches.length;
				indexRef.current = next;
				setResult((current) => ({ ...current, index: next }));
				paintHighlights(matches, next);
				const container = containerRef.current;
				if (container !== null) revealMatch(container, matches[next]);
			};

			if (!store.open) return null;

			const countProps = {
				className: "dshSessionFind_count",
				key: "status",
				role: "status",
				"aria-live": "polite"
			};
			const status =
				store.query.trim() === ""
					? h("span", countProps, t("bar.idle"))
					: paging && result.count === 0
						? h("span", countProps, t("bar.searchingEarlier"))
						: result.missing
							? h("span", { ...countProps, "data-state": "empty" }, t("bar.noScroller"))
							: result.count === 0
								? h(
										"span",
										{ ...countProps, "data-state": "empty" },
										scanLimited ? t("bar.noneScanned", { pages: MAX_SCAN_PAGES }) : t("bar.none")
									)
								: h(
										"span",
										countProps,
										result.capped
											? t("bar.countCapped", { current: result.index + 1, total: result.count })
											: t("bar.count", { current: result.index + 1, total: result.count })
									);

			return h(
				"div",
				{
					className: "dshSessionFind_root",
					ref: rootRef,
					onKeyDown: (event) => {
						// Escape closes from anywhere in the bar, not only while the input
						// holds focus; Enter stays the input's own gesture.
						if (event.key !== "Escape") return;
						event.preventDefault();
						event.stopPropagation();
						findState.close();
					}
				},
				[
				pagingError !== null &&
					h("p", { className: "dshSessionFind_warn", key: "error" }, t("bar.loadFailed", { message: pagingError })),
				h("div", { className: "dshSessionFind_card", key: "card" }, [
					h("input", {
						key: "input",
						ref: inputRef,
						type: "text",
						role: "searchbox",
						autoComplete: "off",
						spellCheck: false,
						className: "dshSessionFind_input",
						placeholder: t("bar.placeholder"),
						"aria-label": t("bar.label"),
						value: store.query,
						onChange: (event) => findState.setQuery(event.target.value),
						onKeyDown: (event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								move(event.shiftKey ? -1 : 1);
							} else if (event.key === "Escape") {
								event.preventDefault();
								event.stopPropagation();
								findState.close();
							}
						}
					}),
					status,
					h("span", { className: "dshSessionFind_sep", key: "sep", "aria-hidden": "true" }),
					h(
						"button",
						{
							key: "prev",
							type: "button",
							className: "dshSessionFind_button",
							title: t("bar.prev"),
							"aria-label": t("bar.prev"),
							disabled: result.count === 0,
							onClick: () => move(-1)
						},
						h(ChevronGlyph, { up: true })
					),
					h(
						"button",
						{
							key: "next",
							type: "button",
							className: "dshSessionFind_button",
							title: t("bar.next"),
							"aria-label": t("bar.next"),
							disabled: result.count === 0,
							onClick: () => move(1)
						},
						h(ChevronGlyph, { up: false })
					),
					hasMore &&
						h(
							"button",
							{
								key: "earlier",
								type: "button",
								className: "dshSessionFind_button",
								title: t("bar.loadEarlier"),
								"aria-label": t("bar.loadEarlier"),
								disabled: paging,
								onClick: () => void scanEarlier(store.query, 1)
							},
							paging ? "…" : t("bar.earlierShort")
						),
					h(
						"button",
						{
							key: "close",
							type: "button",
							className: "dshSessionFind_button",
							title: t("bar.close"),
							"aria-label": t("bar.close"),
							onClick: () => findState.close()
						},
						h(CloseGlyph)
					)
				])
			]);
		}

		// ── plugin ──────────────────────────────────────────────────────────

		/** Required Client services: the slot registry, locale, shortcuts, sessions. */
		const inject = ["slots", "locale", "shortcuts", "sessions"];

		/**
		 * Client plugin body: register the dictionaries, the dock entry, and the
		 * Ctrl+F command that opens it.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "session-find: dictionaries");
			ctx.slots.inject("conversation.input.dock", () =>
				ctx.slots.register(
					{
						name: "conversation.input.dock",
						id: DOCK_ID,
						order: 30,
						locale: NS,
						// The dock's standard props carry no Session service, and the
						// paging button needs one call on the retained Session face.
						inject: () => ({ sessions: ctx.sessions })
					},
					FindDock
				)
			);
			ctx.effect(() => {
				try {
					return ctx.shortcuts.register({
						id: "session.find",
						label: () => t("shortcut.label"),
						aliases: ["find in conversation", "find text", "查找", "在会话中查找"],
						// Desktop only: browsers reserve Mod+F for their own find,
						// so a Web default would be rejected — and a rejected
						// default throws, which must not cost the plugin its bar.
						defaults: {
							"desktop:macos": { code: "KeyF", modifiers: ["primary"] },
							"desktop:windows": { code: "KeyF", modifiers: ["primary"] },
							"desktop:linux": { code: "KeyF", modifiers: ["primary"] }
						},
						regions: ["page", "editable"],
						modals: [],
						resolve: () =>
							findState.isMounted()
								? {
										status: "handled",
										run: () => {
											findState.open();
										}
									}
								: { status: "blocked", reason: t("shortcut.noSession") }
					});
				} catch (error) {
					console.warn("[dsh-session-find] Ctrl+F was not registered; use the Find button", error);
					return undefined;
				}
			}, "session-find: shortcut");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
