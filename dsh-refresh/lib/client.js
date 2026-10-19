/**
 * dsh-refresh, browser half.
 *
 * One control for the question "make this page pick up my changes without
 * dropping the conversation":
 *
 * - A **normal click** reloads the page, exactly like a browser refresh. Before
 *   unloading it snapshots the active Session and the conversation's scroll
 *   position into `sessionStorage`; after the boot it waits for that Session to
 *   be selected again and restores the reading position. DSH itself already
 *   persists the selected Session (`dsh.sessions.current`) and per-Session
 *   drafts, and the Host keeps a running turn alive across the disconnect, so
 *   the reply continues and the transcript is rebuilt from durable events.
 * - **Shift+click** performs the in-place variant: it reads the live
 *   client-plugin graph from the Host's small read-only route and hands it to
 *   the module system's own `entries.sync()`, the same reconciliation the HMR
 *   transport drives. No page reload happens, so React state, the transcript,
 *   the composer, and an in-flight reply are untouched. It is the right choice
 *   for a client-plugin rebuild and the wrong one for a new shell build.
 *
 * The control is additive (`conversation.session.header.actions`, a `list`
 * slot), so it sits in the conversation title row beside the right-sidebar
 * opener. In Desktop the normal click first compares the live graph with the
 * boot manifest; a rebuilt bundle makes it fall back to the in-place sync,
 * because Desktop reuses its Host-start boot injections. The shortcut is
 * registered defensively: F5 belongs to the Desktop profile on purpose (Web
 * browsers reserve it), and a conflicting/reserved binding must not take the
 * button down with it.
 *
 * @module dsh-refresh/client
 */
window.__ModuleLoader__.load({
	id: "dsh-refresh",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const h = react.createElement;

		/** Dictionary namespace owned by this plugin. */
		const NS = "dshRefresh";
		/** This plugin's cell in `conversation.session.header.actions`. */
		const ACTION_ID = "refresh";
		/** This plugin's stylesheet owner id, tagged so the module loader can track it. */
		const STYLE_ID = "dsh-refresh";
		/** Per-tab snapshot carried across a full reload. */
		const PENDING_KEY = "dsh.refresh.pending";
		/** Document-relative Host route serving the live client-plugin graph. */
		const GRAPH_ROUTE = "dsh-refresh/graph";
		/** A stale snapshot is never applied: the next reload starts a new one. */
		const RESTORE_WINDOW_MS = 120000;
		/** How long the reading position may be re-applied while history renders. */
		const RESTORE_DEADLINE_MS = 6000;
		/** Bottom tolerance; a streaming transcript may sit a pixel short. */
		const BOTTOM_EPSILON_PX = 8;

		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"button.label": "刷新",
			"button.busy": "刷新中…",
			"button.hotBusy": "热刷新中…",
			"button.hotDone": "已热刷新",
			"button.hotError": "热刷新失败",
			"button.staleHot": "已热刷新",
			"button.refreshError": "刷新失败",
			"button.title": "刷新页面（当前对话会保留）；Shift+点击：仅热更新插件；桌面端插件已更新时自动改用热刷新",
			"button.hotFailed": "热刷新失败，点击按钮可重试",
			"button.staleHotNote": "桌面端启动清单已更新，已自动改用热刷新",
			"button.refreshFailed": "刷新失败，请重启 DSH 后再试",
			"hot.invalidGraph": "插件清单无效",
			"hot.releaseChanged": "Host 已升级，需要重启 DSH",
			"hot.unsupported": "当前版本不支持热刷新",
			"refresh.cannotVerify": "无法确认插件清单，已取消整页刷新",
			"refresh.releaseChanged": "Host 已升级，请重启 DSH 后再刷新",
			"refresh.unsupported": "当前版本不支持热刷新",
			"refresh.staleHot": "桌面端启动清单已更新，已用热刷新避免整页刷新失败",
			"shortcut.label": "刷新页面"
		};

		/** English dictionary (same key set). */
		const en = {
			"button.label": "Refresh",
			"button.busy": "Refreshing…",
			"button.hotBusy": "Hot refresh…",
			"button.hotDone": "Hot refreshed",
			"button.hotError": "Hot refresh failed",
			"button.staleHot": "Hot refreshed",
			"button.refreshError": "Refresh failed",
			"button.title": "Refresh the page (the current conversation is kept); Shift+click: hot-reload client plugins; Desktop switches to hot refresh when plugins changed",
			"button.hotFailed": "Hot refresh failed; try again",
			"button.staleHotNote": "The Desktop boot manifest changed; hot refresh was used instead",
			"button.refreshFailed": "Refresh failed; restart DSH and try again",
			"hot.invalidGraph": "The plugin manifest is invalid",
			"hot.releaseChanged": "The Host was upgraded; restart DSH",
			"hot.unsupported": "This build does not support hot refresh",
			"refresh.cannotVerify": "Could not verify the plugin manifest; the page reload was cancelled",
			"refresh.releaseChanged": "The Host was upgraded; restart DSH before refreshing",
			"refresh.unsupported": "This build does not support hot refresh",
			"refresh.staleHot": "The Desktop boot manifest changed; hot refresh was used to avoid a failed reload",
			"shortcut.label": "Refresh page"
		};

		// ── styles ──────────────────────────────────────────────────────────
		// Matches the conversation header's own 28px icon controls (for example
		// the right-sidebar opener): square hit target, small radius, secondary
		// ink, hover wash. Only `--dsw-alias-*` tokens are used.

		const stylesheet = `
.dshRefresh_action{box-sizing:border-box;width:28px;height:28px;flex:none;display:inline-flex;align-items:center;justify-content:center;padding:0;border:none;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;line-height:1}
.dshRefresh_action svg{width:15px;height:15px;display:block}
.dshRefresh_action:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshRefresh_action:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.dshRefresh_action:disabled{opacity:.55;cursor:default}
.dshRefresh_action[data-error=true]{color:var(--dsw-alias-state-warn-primary)}
.dshRefresh_spin{animation:dshRefresh_spin .8s linear infinite}
.dshRefresh_srOnly{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@keyframes dshRefresh_spin{to{transform:rotate(360deg)}}
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

		// ── page and conversation state ─────────────────────────────────────

		/**
		 * The Session in the main view.
		 *
		 * Session Controller rows carry one `retainedBy` count per local source;
		 * `mainView` is the source ui-workspace uses for the main Conversation, so
		 * this reads the same row the layout selects. The persisted selection is a
		 * fallback for the first frames after a reload, before the list settles.
		 * @param ctx - client root context.
		 * @returns the active Session id, or undefined.
		 */
		function currentSessionId(ctx) {
			try {
				const list = ctx.sessions?.list?.getSnapshot?.();
				for (const row of Object.values(list?.byId ?? {})) {
					if ((row?.retainedBy?.mainView ?? 0) > 0) return row.id;
				}
			} catch (error) {
				console.warn("[dsh-refresh] could not read the session list", error);
			}
			try {
				const stored = JSON.parse(globalThis.localStorage?.getItem("dsh.sessions.current") ?? "null");
				return typeof stored?.sessionId === "string" ? stored.sessionId : undefined;
			} catch {
				return undefined;
			}
		}

		/**
		 * Find the main conversation's scrollport from the document.
		 *
		 * The layout marks its scrollport: `data-conversation-content` is the body
		 * and `data-conversation-scroll` its scrolling child, the same pair the
		 * platform resolves for its own wheel handling. Prefer a mounted, visible
		 * one; the right sidebar can host another conversation body.
		 * @returns the scroll container, or null.
		 */
		function findConversationScroll() {
			if (typeof document === "undefined") return null;
			for (const content of document.querySelectorAll("[data-conversation-content]")) {
				const scroller = content.querySelector(":scope > [data-conversation-scroll]") ?? content.querySelector("[data-conversation-scroll]");
				if (scroller !== null && scroller.clientHeight > 0) return scroller;
			}
			const direct = document.querySelector("[data-conversation-scroll]");
			return direct !== null && direct.clientHeight > 0 ? direct : null;
		}

		/**
		 * Snapshot where the reader is before the page goes away.
		 * @param ctx - client root context.
		 * @returns the snapshot, or null when there is no conversation to keep.
		 */
		function captureSnapshot(ctx) {
			const sessionId = currentSessionId(ctx);
			const scroller = findConversationScroll();
			if (typeof sessionId !== "string" || scroller === null) return null;
			const scrollHeight = scroller.scrollHeight;
			const clientHeight = scroller.clientHeight;
			if (!(scrollHeight > 0) || !(clientHeight > 0)) return null;
			return {
				t: Date.now(),
				sessionId,
				scrollTop: scroller.scrollTop,
				scrollHeight,
				clientHeight,
				atBottom: scrollHeight - scroller.scrollTop - clientHeight <= BOTTOM_EPSILON_PX
			};
		}

		/** Store one snapshot for the next boot; storage failures are not fatal. */
		function storePending(snapshot) {
			if (snapshot === null) return;
			try {
				globalThis.sessionStorage?.setItem(PENDING_KEY, JSON.stringify(snapshot));
			} catch (error) {
				console.warn("[dsh-refresh] could not store the conversation position", error);
			}
		}

		/**
		 * Capture the conversation position and reload the document.
		 * @param ctx - client root context.
		 */
		function captureAndReload(ctx) {
			try {
				storePending(captureSnapshot(ctx));
			} catch (error) {
				console.warn("[dsh-refresh] could not capture the conversation position", error);
			}
			globalThis.location.reload();
		}

		/** Whether this page is the Desktop shell, which reuses its Host-start boot injections. */
		function isDesktopShell() {
			return globalThis.__DSH_TRANSPORT__?.ownsHost === true;
		}

		/** Compare two `WebBootRelease` values without assuming the optional commit. */
		function sameRelease(left, right) {
			if (left === undefined && right === undefined) return true;
			if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
			return left.version === right.version && (left.commit ?? "") === (right.commit ?? "");
		}

		/**
		 * Whether every boot-manifest entry and batch still has its boot revision.
		 *
		 * Desktop keeps the boot injections captured when its Host started, so a
		 * page reload after a client bundle rebuild asks for the old revision —
		 * which the Host may no longer serve. A reload then fails the boot; the
		 * in-place sync is the safe way to pick the change up.
		 * @param boot - `window.__DSH_BOOT__`.
		 * @param graph - the live graph.
		 * @returns true when the boot manifest is fully current.
		 */
		function bootManifestMatches(boot, graph) {
			if (boot === null || graph === null || typeof boot !== "object" || typeof graph !== "object") return false;
			if (!sameRelease(boot.release, graph.release)) return false;
			const bootEntries = new Map((Array.isArray(boot.entries) ? boot.entries : []).map((row) => [row.id, `${String(row.rev)}|${String(row.url)}`]));
			const graphEntries = new Map((Array.isArray(graph.entries) ? graph.entries : []).map((row) => [row.id, `${String(row.rev)}|${String(row.url)}`]));
			if (bootEntries.size !== graphEntries.size) return false;
			for (const [id, target] of bootEntries) if (graphEntries.get(id) !== target) return false;
			const bootBatches = new Map((Array.isArray(boot.batches) ? boot.batches : []).map((row) => [`${String(row.phase)}:${String(row.url)}`, String(row.rev)]));
			const graphBatches = new Map((Array.isArray(graph.batches) ? graph.batches : []).map((row) => [`${String(row.phase)}:${String(row.url)}`, String(row.rev)]));
			if (bootBatches.size !== graphBatches.size) return false;
			for (const [key, rev] of bootBatches) if (graphBatches.get(key) !== rev) return false;
			return true;
		}

		/**
		 * Fetch the live client-plugin graph from the Host's read-only route.
		 * @param t - dictionary-bound translator.
		 * @returns the validated graph.
		 */
		async function fetchGraph(t) {
			const response = await fetch(GRAPH_ROUTE, {
				method: "GET",
				headers: { accept: "application/json" },
				cache: "no-store"
			});
			if (!response.ok) throw new Error(`${t("hot.invalidGraph")} (HTTP ${String(response.status)})`);
			const payload = await response.json();
			const graph = payload?.graph ?? payload;
			if (graph === null || typeof graph !== "object" || !Array.isArray(graph.entries)) throw new Error(t("hot.invalidGraph"));
			return graph;
		}

		/**
		 * In-place refresh: fetch the live graph and let the module system reconcile
		 * entries and changed revisions, exactly as the HMR graph frame does.
		 * @param ctx - client root context.
		 * @param t - dictionary-bound translator.
		 * @returns after the reconciliation queue settles.
		 */
		async function syncClientPlugins(ctx, t) {
			const entries = ctx.modules?.entries;
			if (entries === undefined || typeof entries.sync !== "function") throw new Error(t("hot.unsupported"));
			const graph = await fetchGraph(t);
			const bootRelease = globalThis.__DSH_BOOT__?.release;
			if (bootRelease !== undefined && graph.release !== undefined && !sameRelease(bootRelease, graph.release)) {
				throw new Error(t("hot.releaseChanged"));
			}
			await entries.sync(graph);
		}

		/**
		 * Safe full refresh.
		 *
		 * On Web the Host renders a fresh boot manifest for every document, so a
		 * reload is always safe. Desktop reuses the injections captured at Host
		 * start; when the live graph has moved on (a client bundle was rebuilt), a
		 * reload would ask for a revision the Host no longer serves. The guard
		 * compares both and falls back to the in-place sync instead of breaking the
		 * boot.
		 * @param ctx - client root context.
		 * @param t - dictionary-bound translator.
		 * @returns "reloaded" when a reload was started, "hot" when the in-place
		 * sync replaced the reload.
		 */
		async function safeFullRefresh(ctx, t) {
			if (!isDesktopShell()) {
				captureAndReload(ctx);
				return "reloaded";
			}
			const boot = globalThis.__DSH_BOOT__;
			const graph = await fetchGraph(t).catch((error) => {
				throw new Error(`${t("refresh.cannotVerify")}: ${error?.message ?? error}`);
			});
			if (boot?.release !== undefined && graph.release !== undefined && !sameRelease(boot.release, graph.release)) {
				throw new Error(t("refresh.releaseChanged"));
			}
			if (!bootManifestMatches(boot, graph)) {
				const entries = ctx.modules?.entries;
				if (entries === undefined || typeof entries.sync !== "function") throw new Error(t("refresh.unsupported"));
				await entries.sync(graph);
				return "hot";
			}
			captureAndReload(ctx);
			return "reloaded";
		}

		/**
		 * Restore the reading position once the conversation has been reselected.
		 *
		 * The frame loop tolerates late history and streaming growth, and stops at
		 * the first pointer, wheel, touch, or key input so it never fights a reader
		 * who has started scrolling again. A different active Session aborts it
		 * immediately: restoring into someone else's conversation would be worse
		 * than losing the position.
		 * @param ctx - client root context.
		 * @returns a disposer that stops the restoration.
		 */
		function restoreScroll(ctx) {
			let pending;
			try {
				const raw = globalThis.sessionStorage?.getItem(PENDING_KEY);
				globalThis.sessionStorage?.removeItem(PENDING_KEY);
				pending = raw === null || raw === undefined ? null : JSON.parse(raw);
			} catch {
				return () => {};
			}
			if (pending === null || typeof pending !== "object" || typeof pending.t !== "number") return () => {};
			if (Date.now() - pending.t > RESTORE_WINDOW_MS) return () => {};
			if (typeof pending.sessionId !== "string") return () => {};

			let stopped = false;
			let frame = 0;
			const deadline = Date.now() + RESTORE_DEADLINE_MS;
			const stop = () => {
				if (stopped) return;
				stopped = true;
				if (frame !== 0) cancelAnimationFrame(frame);
				frame = 0;
				for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) {
					globalThis.removeEventListener?.(type, stop, true);
				}
			};
			for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) {
				globalThis.addEventListener?.(type, stop, { capture: true, passive: true });
			}

			const tick = () => {
				frame = 0;
				if (stopped) return;
				const active = currentSessionId(ctx);
				if (active !== undefined && active !== pending.sessionId) {
					stop();
					return;
				}
				const scroller = findConversationScroll();
				if (scroller !== null && active === pending.sessionId) {
					const range = scroller.scrollHeight - scroller.clientHeight;
					if (range > 0) {
						let target;
						if (pending.atBottom === true) {
							target = range;
						} else {
							const savedRange = pending.scrollHeight - pending.clientHeight;
							target = savedRange > 0 ? (pending.scrollTop / savedRange) * range : pending.scrollTop;
						}
						scroller.scrollTop = Math.max(0, Math.min(target, range));
					}
				}
				if (Date.now() < deadline) frame = requestAnimationFrame(tick);
				else stop();
			};

			frame = requestAnimationFrame(tick);
			return stop;
		}

		// ── header entry ────────────────────────────────────────────────────

		/**
		 * One glyph per visible state, drawn locally so icon-name drift between
		 * Web and Desktop builds cannot take the control down.
		 * @param props - optional animation class.
		 * @returns the refresh arrow.
		 */
		function RefreshGlyph({ className } = {}) {
			return h(
				"svg",
				{ className, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
				h("path", {
					d: "M13 8a5 5 0 1 1-1.46-3.54",
					stroke: "currentColor",
					strokeWidth: 1.5,
					strokeLinecap: "round"
				}),
				h("path", {
					d: "M13 2.6V6H9.6",
					stroke: "currentColor",
					strokeWidth: 1.5,
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			);
		}

		/** A check for a completed hot refresh. */
		function CheckGlyph() {
			return h(
				"svg",
				{ viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
				h("path", {
					d: "M3 8.4 6.3 11.7 13 4.8",
					stroke: "currentColor",
					strokeWidth: 1.6,
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			);
		}

		/** An exclamation for a refused or failed refresh. */
		function ErrorGlyph() {
			return h(
				"svg",
				{ viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
				h("path", { d: "M8 3.2v5.6", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" }),
				h("circle", { cx: 8, cy: 12, r: 0.9, fill: "currentColor" })
			);
		}

		/**
		 * The refresh control in the conversation header's action strip.
		 *
		 * Icon-only on purpose: the strip already holds the Jobs and Subagent
		 * controls, so a labelled button would be the odd one out. The tooltip
		 * carries the full explanation, and a visually hidden status line announces
		 * completed or refused refreshes to assistive technology.
		 * @param props - `t` and the injected refresh actions.
		 * @returns the 28px header action.
		 */
		function RefreshAction({ t, refreshPage, syncPlugins }) {
			const [phase, setPhase] = react.useState("idle");
			const [detail, setDetail] = react.useState("");
			const timer = react.useRef(0);
			const mounted = react.useRef(true);

			react.useEffect(() => {
				// Setup must restore the flag: StrictMode mounts, cleans up, and mounts
				// again, and a cleanup-only effect would leave every later click dead.
				mounted.current = true;
				return () => {
					mounted.current = false;
					if (timer.current !== 0) window.clearTimeout(timer.current);
				};
			}, []);

			const resetSoon = react.useCallback((delay) => {
				if (timer.current !== 0) window.clearTimeout(timer.current);
				timer.current = window.setTimeout(() => {
					timer.current = 0;
					if (!mounted.current) return;
					setPhase("idle");
					setDetail("");
				}, delay);
			}, []);

			const onClick = react.useCallback(
				(event) => {
					event.preventDefault();
					if (phase === "checking" || phase === "hot-busy") return;
					if (event.shiftKey) {
						setPhase("hot-busy");
						setDetail("");
						syncPlugins().then(
							() => {
								if (!mounted.current) return;
								setPhase("hot-done");
								resetSoon(1800);
							},
							(error) => {
								console.warn("[dsh-refresh] hot refresh failed", error);
								if (!mounted.current) return;
								setDetail(String(error?.message ?? error));
								setPhase("hot-error");
								resetSoon(4500);
							}
						);
						return;
					}
					setPhase("checking");
					setDetail("");
					refreshPage().then(
						(outcome) => {
							if (!mounted.current) return;
							if (outcome !== "hot") return;
							setDetail(t("refresh.staleHot"));
							setPhase("stale-hot");
							resetSoon(5000);
						},
						(error) => {
							console.warn("[dsh-refresh] refresh failed", error);
							if (!mounted.current) return;
							setDetail(String(error?.message ?? error));
							setPhase("error");
							resetSoon(6000);
						}
					);
				},
				[phase, refreshPage, resetSoon, syncPlugins, t]
			);

			const busy = phase === "checking" || phase === "hot-busy";
			const done = phase === "hot-done" || phase === "stale-hot";
			const failed = phase === "hot-error" || phase === "error";
			const label =
				phase === "checking"
					? t("button.busy")
					: phase === "hot-busy"
						? t("button.hotBusy")
						: done
							? t("button.hotDone")
							: phase === "hot-error"
								? t("button.hotError")
								: phase === "error"
									? t("button.refreshError")
									: t("button.label");
			const note =
				phase === "hot-error"
					? t("button.hotFailed")
					: phase === "stale-hot"
						? t("button.staleHotNote")
						: phase === "error"
							? t("button.refreshFailed")
							: "";
			const title = detail !== "" ? `${t("button.title")} — ${detail}` : t("button.title");

			return h(
				"button",
				{
					type: "button",
					className: "dshRefresh_action",
					title,
					"aria-label": label,
					"aria-busy": busy ? "true" : undefined,
					"data-error": failed ? "true" : undefined,
					onClick
				},
				busy
					? h(RefreshGlyph, { className: "dshRefresh_spin" })
					: done
						? h(CheckGlyph)
						: failed
							? h(ErrorGlyph)
							: h(RefreshGlyph),
				note !== "" ? h("span", { className: "dshRefresh_srOnly", role: "status" }, note) : null
			);
		}

		// ── plugin ──────────────────────────────────────────────────────────

		/** Required Client services: slots, locale, shortcuts, sessions, modules. */
		const inject = ["slots", "locale", "shortcuts", "sessions", "modules"];

		/**
		 * Client plugin body: dictionaries, the header action, the full-refresh
		 * shortcut, and the post-reload scroll restoration.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			const t = ctx.locale.bind(NS);

			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-refresh: dictionaries");

			// The conversation title row's action strip sits beside the right-sidebar
			// opener, so the control reads as window chrome rather than as another
			// composer accessory. It is session-scoped: the strip only exists while a
			// conversation is selected.
			ctx.slots.inject("conversation.session.header.actions", () =>
				ctx.slots.register(
					{
						name: "conversation.session.header.actions",
						id: ACTION_ID,
						order: 30,
						locale: NS,
						inject: () => ({
							refreshPage: () => safeFullRefresh(ctx, t),
							syncPlugins: () => syncClientPlugins(ctx, t)
						})
					},
					RefreshAction
				)
			);

			ctx.effect(() => {
				try {
					return ctx.shortcuts.register({
						id: "app.refresh",
						label: () => t("shortcut.label"),
						aliases: ["refresh", "reload", "refresh page", "reload page", "刷新", "刷新页面", "重新加载"],
						// Desktop only: browsers reserve F5 for their own refresh, so a Web
						// default would be rejected at registration. Web users can bind it
						// in Settings → Shortcuts; the button is always available.
						defaults: {
							"desktop:macos": { code: "F5", modifiers: [] },
							"desktop:windows": { code: "F5", modifiers: [] },
							"desktop:linux": { code: "F5", modifiers: [] }
						},
						regions: ["page", "editable"],
						modals: [],
						resolve: () => ({
							status: "handled",
							run: () => {
								safeFullRefresh(ctx, t).catch((error) => {
									console.warn("[dsh-refresh] refresh failed", error);
								});
							}
						})
					});
				} catch (error) {
					console.warn("[dsh-refresh] F5 was not registered; use the Refresh button", error);
					return undefined;
				}
			}, "dsh-refresh: shortcut");

			ctx.effect(() => restoreScroll(ctx), "dsh-refresh: scroll restore");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
