/**
 * dsh-english-coach, browser half.
 *
 * Three additive surfaces, no host DOM touched:
 *
 * - `conversation.input.dock` — a one-line receipt for the latest reviewed
 *   message, expandable to the individual issues. It polls the Host's small
 *   JSON route because a third-party bundle cannot register its own Remote
 *   namespace; the same-route precedent is `dsh-refresh`.
 * - `sidebar.panellist` + `main` — the coach page: overview, mistake notebook,
 *   dictionary, and settings. The sidebar id and the main key are the same
 *   string, which is how the layout addresses the panel.
 * - A style tag owned by this plugin, inserted and removed with it.
 *
 * @module dsh-english-coach/client
 */
window.__ModuleLoader__.load({
	id: "dsh-english-coach",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const h = React.createElement;
		const { useState, useEffect, useRef } = React;

		/** Dictionary namespace. */
		const NS = "englishCoach";
		/** The panel id; also the main slot key and the sidebar list id. */
		const PANEL_ID = "english-coach";
		/** Document-relative API base: the page and the route share an origin. */
		const API = "dsh-english-coach/api";

		const CATEGORIES = [
			"spelling",
			"article",
			"tense",
			"agreement",
			"preposition",
			"word-form",
			"collocation",
			"word-choice",
			"word-order",
			"plural",
			"chinglish",
			"register",
			"punctuation",
			"concision",
		];

		const TABS = [
			["overview", "tab.overview"],
			["notebook", "tab.notebook"],
			["words", "tab.words"],
			["settings", "tab.settings"],
		];

		const zh = {
			"panel.name": "英语教练",
			"panel.title": "英语教练",
			"panel.subtitle": "你写下的英文，顺手批改、记录、查词",
			"tab.overview": "概览",
			"tab.notebook": "错题本",
			"tab.words": "查词",
			"tab.settings": "设置",
			"common.loading": "正在加载…",
			"common.retry": "重试",
			"common.error": "加载失败：{message}",
			"common.empty": "还没有内容。",
			"common.refresh": "刷新",
			"common.export": "导出",
			"overview.reviews": "批改句数",
			"overview.issues": "问题数",
			"overview.density": "每百词问题",
			"overview.words": "累计词数",
			"overview.byCategory": "问题分布",
			"overview.trend": "近 8 周趋势",
			"overview.recent": "最近的批改",
			"overview.empty": "还没有记录。用英文发一条消息，批改会自动开始。",
			"overview.densityUnit": "个",
			"overview.week": "{reviews} 句 · {issues} 个问题",
			"notebook.search": "搜索原文、改法或解释",
			"notebook.apply": "搜索",
			"notebook.all": "全部",
			"notebook.onlyOpen": "只看未掌握",
			"notebook.empty": "还没有错题。",
			"notebook.noMatch": "没有符合条件的记录。",
			"notebook.corrected": "建议",
			"notebook.session": "会话 {id}",
			"notebook.today": "今天",
			"notebook.master": "已掌握",
			"notebook.dismiss": "忽略",
			"notebook.issueCount": "{count} 处",
			"notebook.limit": "只显示最近 100 条；更多请用导出。",
			"words.title": "查词",
			"words.placeholder": "输入单词或短语，例如 ubiquitous",
			"words.button": "查询",
			"words.searching": "查询中…",
			"words.notFound": "没查到「{term}」",
			"words.save": "加入生词本",
			"words.saved": "已加入生词本",
			"words.remove": "移出生词本",
			"words.savedTitle": "生词本",
			"words.savedEmpty": "生词本还是空的。",
			"words.phonetic": "音标",
			"words.zh": "中文",
			"words.definitions": "释义",
			"words.example": "例",
			"words.source": "来源：{source}",
			"settings.title": "设置",
			"settings.enabled": "自动批改",
			"settings.enabledHint": "关闭后不再自动批改新消息。",
			"settings.quiet": "安静模式",
			"settings.quietHint": "只记录，不在输入框上方显示摘要条。",
			"settings.showClean": "表达正确时也提示",
			"settings.level": "英语水平",
			"settings.level.beginner": "入门",
			"settings.level.intermediate": "中级",
			"settings.level.advanced": "高级",
			"settings.model": "批改模型",
			"settings.modelHint": "留空跟随默认模型；也可填 provider/model，例如 deepseek/deepseek-chat",
			"settings.minWords": "最少词数",
			"settings.explainLocale": "解释语言",
			"settings.explainLocale.zh": "中文",
			"settings.explainLocale.en": "English",
			"settings.save": "保存",
			"settings.saved": "已保存",
			"settings.export": "导出 Markdown",
			"settings.exportJson": "导出 JSON",
			"settings.dataPath": "数据保存在本机",
			"settings.privacy": "批改时，消息文本会发送给你配置的模型提供商。所有记录只保存在本机。",
			"dock.checking": "正在检查表达…",
			"dock.issues": "{count} 处可改进",
			"dock.clean": "表达正确",
			"dock.expand": "展开",
			"dock.collapse": "收起",
			"dock.open": "错题本",
			"dock.dismiss": "知道了",
			"category.spelling": "拼写",
			"category.article": "冠词",
			"category.tense": "时态",
			"category.agreement": "主谓一致",
			"category.preposition": "介词",
			"category.word-form": "词形",
			"category.collocation": "搭配",
			"category.word-choice": "用词",
			"category.word-order": "语序",
			"category.plural": "单复数",
			"category.chinglish": "中式表达",
			"category.register": "语域",
			"category.punctuation": "标点",
			"category.concision": "冗余",
		};

		const en = {
			"panel.name": "English Coach",
			"panel.title": "English Coach",
			"panel.subtitle": "Corrections, a mistake notebook, and a dictionary for the English you write",
			"tab.overview": "Overview",
			"tab.notebook": "Notebook",
			"tab.words": "Dictionary",
			"tab.settings": "Settings",
			"common.loading": "Loading…",
			"common.retry": "Retry",
			"common.error": "Could not load: {message}",
			"common.empty": "Nothing here yet.",
			"common.refresh": "Refresh",
			"common.export": "Export",
			"overview.reviews": "Reviews",
			"overview.issues": "Issues",
			"overview.density": "Issues / 100 words",
			"overview.words": "Words",
			"overview.byCategory": "Issue distribution",
			"overview.trend": "Last 8 weeks",
			"overview.recent": "Recent reviews",
			"overview.empty": "No reviews yet. Send a message in English and the coach will start.",
			"overview.densityUnit": "",
			"overview.week": "{reviews} reviews · {issues} issues",
			"notebook.search": "Search text, fixes, or notes",
			"notebook.apply": "Search",
			"notebook.all": "All",
			"notebook.onlyOpen": "Unmastered only",
			"notebook.empty": "No mistakes recorded yet.",
			"notebook.noMatch": "No matching records.",
			"notebook.corrected": "Suggested",
			"notebook.session": "Session {id}",
			"notebook.today": "Today",
			"notebook.master": "Mastered",
			"notebook.dismiss": "Dismiss",
			"notebook.issueCount": "{count} issues",
			"notebook.limit": "Showing the latest 100; export for more.",
			"words.title": "Dictionary",
			"words.placeholder": "Type a word or phrase, e.g. ubiquitous",
			"words.button": "Look up",
			"words.searching": "Looking up…",
			"words.notFound": "No entry for “{term}”",
			"words.save": "Add to wordbook",
			"words.saved": "In wordbook",
			"words.remove": "Remove from wordbook",
			"words.savedTitle": "Wordbook",
			"words.savedEmpty": "The wordbook is empty.",
			"words.phonetic": "Phonetic",
			"words.zh": "Chinese",
			"words.definitions": "Definitions",
			"words.example": "e.g.",
			"words.source": "Source: {source}",
			"settings.title": "Settings",
			"settings.enabled": "Automatic review",
			"settings.enabledHint": "Turn this off to stop reviewing new messages automatically.",
			"settings.quiet": "Quiet mode",
			"settings.quietHint": "Record reviews without showing the strip above the composer.",
			"settings.showClean": "Also tell me when the text is correct",
			"settings.level": "English level",
			"settings.level.beginner": "Beginner",
			"settings.level.intermediate": "Intermediate",
			"settings.level.advanced": "Advanced",
			"settings.model": "Review model",
			"settings.modelHint": "Leave empty to follow the default model; or use provider/model, e.g. deepseek/deepseek-chat",
			"settings.minWords": "Minimum words",
			"settings.explainLocale": "Explanation language",
			"settings.explainLocale.zh": "中文",
			"settings.explainLocale.en": "English",
			"settings.save": "Save",
			"settings.saved": "Saved",
			"settings.export": "Export Markdown",
			"settings.exportJson": "Export JSON",
			"settings.dataPath": "Data is stored locally at",
			"settings.privacy": "Reviews send the message text to your configured model provider. All records stay on this machine.",
			"dock.checking": "Checking your wording…",
			"dock.issues": "{count} issues",
			"dock.clean": "Looks correct",
			"dock.expand": "Show",
			"dock.collapse": "Hide",
			"dock.open": "Notebook",
			"dock.dismiss": "Got it",
			"category.spelling": "Spelling",
			"category.article": "Article",
			"category.tense": "Tense",
			"category.agreement": "Agreement",
			"category.preposition": "Preposition",
			"category.word-form": "Word form",
			"category.collocation": "Collocation",
			"category.word-choice": "Word choice",
			"category.word-order": "Word order",
			"category.plural": "Plural",
			"category.chinglish": "Chinglish",
			"category.register": "Register",
			"category.punctuation": "Punctuation",
			"category.concision": "Concision",
		};

		const stylesheet = `
.dshEnglishCoach_page{width:100%;min-width:0;height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.6}
.dshEnglishCoach_header{flex:none;display:flex;align-items:flex-end;gap:24px;padding:18px 24px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dshEnglishCoach_heading{flex:1;min-width:0;padding-bottom:10px}
.dshEnglishCoach_title{font-size:18px;font-weight:600;line-height:1.3}
.dshEnglishCoach_subtitle{margin-top:2px;color:var(--dsw-alias-label-secondary);font-size:12px}
.dshEnglishCoach_tabs{display:flex;gap:2px}
.dshEnglishCoach_tab{height:32px;padding:0 10px;border:none;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:13px}
.dshEnglishCoach_tab:hover{color:var(--dsw-alias-label-primary)}
.dshEnglishCoach_tabActive{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary)}
.dshEnglishCoach_body{flex:1;min-height:0;overflow:auto;padding:20px 24px 48px}
.dshEnglishCoach_stack{display:flex;flex-direction:column;gap:24px;max-width:900px}
.dshEnglishCoach_stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.dshEnglishCoach_stat{padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.dshEnglishCoach_statValue{font-size:22px;font-weight:600;line-height:1.2;font-variant-numeric:tabular-nums}
.dshEnglishCoach_statUnit{margin-left:2px;font-size:12px;font-weight:400;color:var(--dsw-alias-label-secondary)}
.dshEnglishCoach_statLabel{margin-top:2px;color:var(--dsw-alias-label-secondary);font-size:12px}
.dshEnglishCoach_section{display:flex;flex-direction:column;gap:8px}
.dshEnglishCoach_sectionTitle{margin:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.dshEnglishCoach_barRow{display:grid;grid-template-columns:72px 1fr 36px;align-items:center;gap:10px}
.dshEnglishCoach_barLabel{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:12px}
.dshEnglishCoach_barTrack{height:8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.dshEnglishCoach_barFill{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary)}
.dshEnglishCoach_barValue{text-align:right;color:var(--dsw-alias-label-secondary);font-size:12px;font-variant-numeric:tabular-nums}
.dshEnglishCoach_weeks{display:flex;align-items:flex-end;gap:6px;height:96px;padding:6px 2px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dshEnglishCoach_week{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:4px;height:100%}
.dshEnglishCoach_weekBar{width:100%;max-width:28px;border-radius:4px 4px 0 0;background:var(--dsw-alias-brand-primary);opacity:.75}
.dshEnglishCoach_weekLabel{color:var(--dsw-alias-label-secondary);font-size:10px;white-space:nowrap}
.dshEnglishCoach_weeksMeta{margin-top:6px;color:var(--dsw-alias-label-secondary);font-size:12px}
.dshEnglishCoach_review{padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:8px}
.dshEnglishCoach_reviewMeta{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--dsw-alias-label-secondary);font-size:11px}
.dshEnglishCoach_original{white-space:pre-wrap;word-break:break-word}
.dshEnglishCoach_corrected{padding:6px 10px;border-left:2px solid var(--dsw-alias-state-success-primary);background:var(--dsw-alias-bg-layer-2);border-radius:0 6px 6px 0;white-space:pre-wrap;word-break:break-word}
.dshEnglishCoach_correctedLabel{display:block;margin-bottom:1px;color:var(--dsw-alias-label-secondary);font-size:11px}
.dshEnglishCoach_issues{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.dshEnglishCoach_issue{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base)}
.dshEnglishCoach_chip{flex:none;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px}
.dshEnglishCoach_before{color:var(--dsw-alias-label-secondary);text-decoration:line-through;text-decoration-thickness:1px}
.dshEnglishCoach_arrow{color:var(--dsw-alias-label-secondary);font-size:11px}
.dshEnglishCoach_after{font-weight:500}
.dshEnglishCoach_note{flex:1 1 100%;color:var(--dsw-alias-label-secondary);font-size:12px}
.dshEnglishCoach_actions{flex:1 1 100%;display:flex;gap:8px}
.dshEnglishCoach_link{padding:0;border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:11px;text-decoration:underline;text-underline-offset:2px}
.dshEnglishCoach_link:hover{color:var(--dsw-alias-label-primary)}
.dshEnglishCoach_filters{display:flex;gap:8px;margin-bottom:10px}
.dshEnglishCoach_input{flex:1;min-width:0;height:30px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;outline:none}
.dshEnglishCoach_input:focus{border-color:var(--dsw-alias-brand-primary)}
.dshEnglishCoach_button{flex:none;height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:13px}
.dshEnglishCoach_button:hover{background:var(--dsw-alias-bg-layer-2)}
.dshEnglishCoach_button:disabled{opacity:.5;cursor:default}
.dshEnglishCoach_buttonGhost{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary)}
.dshEnglishCoach_chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.dshEnglishCoach_chipButton{height:24px;padding:0 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:11px}
.dshEnglishCoach_chipButtonActive{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}
.dshEnglishCoach_chipButton:hover{color:var(--dsw-alias-label-primary)}
.dshEnglishCoach_list{display:flex;flex-direction:column;gap:10px}
.dshEnglishCoach_empty{padding:36px 12px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:13px}
.dshEnglishCoach_error{padding:12px 14px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px;color:var(--dsw-alias-state-error-primary);font-size:13px;display:flex;align-items:center;gap:12px}
.dshEnglishCoach_loading{padding:36px 12px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:13px}
.dshEnglishCoach_limit{margin-top:10px;color:var(--dsw-alias-label-secondary);font-size:11px}
.dshEnglishCoach_wordForm{display:flex;gap:8px;margin-bottom:14px}
.dshEnglishCoach_wordCard{padding:14px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:10px}
.dshEnglishCoach_wordHead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.dshEnglishCoach_wordTerm{font-size:20px;font-weight:600;line-height:1.3}
.dshEnglishCoach_wordPhonetic{margin-left:8px;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-mono,monospace);font-size:13px}
.dshEnglishCoach_wordZh{padding:6px 10px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);font-size:13px}
.dshEnglishCoach_meaning{display:flex;flex-direction:column;gap:2px}
.dshEnglishCoach_pos{color:var(--dsw-alias-label-secondary);font-size:11px;font-style:italic}
.dshEnglishCoach_defs{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:3px}
.dshEnglishCoach_defs li{font-size:13px}
.dshEnglishCoach_ex{margin-left:6px;color:var(--dsw-alias-label-secondary);font-size:12px;font-style:italic}
.dshEnglishCoach_wordSource{color:var(--dsw-alias-label-secondary);font-size:11px}
.dshEnglishCoach_savedList{display:flex;flex-direction:column;gap:6px}
.dshEnglishCoach_savedItem{display:flex;align-items:baseline;gap:8px;padding:7px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.dshEnglishCoach_savedTerm{font-weight:500}
.dshEnglishCoach_savedZh{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:12px}
.dshEnglishCoach_settings{display:flex;flex-direction:column;gap:18px;max-width:620px}
.dshEnglishCoach_field{display:flex;flex-direction:column;gap:5px}
.dshEnglishCoach_fieldLabel{display:block;font-size:13px;font-weight:500}
.dshEnglishCoach_fieldHint{display:block;color:var(--dsw-alias-label-secondary);font-size:11px}
.dshEnglishCoach_checkboxRow{display:flex;align-items:flex-start;gap:8px}
.dshEnglishCoach_checkboxRow input{margin-top:4px}
.dshEnglishCoach_select{height:30px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.dshEnglishCoach_footer{display:flex;align-items:center;gap:12px;padding-top:4px}
.dshEnglishCoach_savedFlag{color:var(--dsw-alias-state-success-primary);font-size:12px}
.dshEnglishCoach_exportRow{display:flex;flex-wrap:wrap;gap:8px}
.dshEnglishCoach_exportLink{display:inline-flex;align-items:center;height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);text-decoration:none;font-size:13px}
.dshEnglishCoach_exportLink:hover{background:var(--dsw-alias-bg-layer-2)}
.dshEnglishCoach_code{display:block;margin-top:4px;padding:8px 10px;border-radius:7px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-mono,monospace);font-size:11px;word-break:break-all}
.dshEnglishCoach_privacy{color:var(--dsw-alias-label-secondary);font-size:12px}
.dshEnglishCoach_dock{margin:0 12px 8px}
.dshEnglishCoach_dockCard{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.dshEnglishCoach_dockRow{display:flex;align-items:center;gap:8px;min-height:32px;padding:4px 10px}
.dshEnglishCoach_dockIcon{display:inline-flex;flex:none;color:var(--dsw-alias-brand-primary)}
.dshEnglishCoach_dockSummary{font-size:12px}
.dshEnglishCoach_dockCats{min-width:0;flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:12px}
.dshEnglishCoach_dockSpacer{flex:1}
.dshEnglishCoach_dockButton{flex:none;height:22px;padding:0 7px;border:none;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:11px}
.dshEnglishCoach_dockButton:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dshEnglishCoach_dockBody{display:flex;flex-direction:column;gap:6px;padding:6px 10px 8px;border-top:1px solid var(--dsw-alias-border-l1)}
.dshEnglishCoach_dockIssue{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;font-size:12px}
.dshEnglishCoach_dockNote{flex:1 1 100%;color:var(--dsw-alias-label-secondary);font-size:11px}
.dshEnglishCoach_pulse{width:6px;height:6px;border-radius:999px;background:var(--dsw-alias-brand-primary);animation:dshEnglishCoachPulse 1.2s ease-in-out infinite}
@keyframes dshEnglishCoachPulse{0%,100%{opacity:.25}50%{opacity:1}}
`;

		// ── API ─────────────────────────────────────────────────────────────

		/**
		 * GET one JSON endpoint.
		 * @param path - endpoint name under the API base.
		 * @param params - query parameters.
		 * @param signal - caller cancellation.
		 * @returns the decoded JSON body.
		 */
		async function apiGet(path, params, signal) {
			const query = params === undefined ? "" : `?${new URLSearchParams(params).toString()}`;
			const response = await fetch(`${API}/${path}${query}`, {
				signal,
				headers: { accept: "application/json" },
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			return response.json();
		}

		/**
		 * POST one JSON endpoint.
		 * @param path - endpoint name under the API base.
		 * @param body - JSON body.
		 * @returns the decoded JSON body.
		 */
		async function apiPost(path, body) {
			const response = await fetch(`${API}/${path}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			return response.json();
		}

		/**
		 * Read one endpoint with a status snapshot and a retry trigger.
		 * @param path - endpoint name.
		 * @param params - query parameters; changes retrigger the read.
		 * @returns the read state and a retry trigger.
		 */
		function useApi(path, params) {
			const key = JSON.stringify(params ?? null);
			const [state, setState] = useState({ status: "loading" });
			const [nonce, setNonce] = useState(0);
			useEffect(() => {
				const controller = new AbortController();
				const parsed = key === "null" ? undefined : JSON.parse(key);
				setState((current) => (current.status === "ready" ? current : { status: "loading" }));
				apiGet(path, parsed, controller.signal)
					.then((data) => setState({ status: "ready", data }))
					.catch((error) => {
						if (!controller.signal.aborted) setState({ status: "error", error });
					});
				return () => controller.abort();
			}, [path, key, nonce]);
			return [state, () => setNonce((value) => value + 1)];
		}

		// ── icons ───────────────────────────────────────────────────────────

		/**
		 * The coach mark: a pencil.
		 * @param props - `size` and optional `active`.
		 * @returns the SVG.
		 */
		function CoachIcon({ size = 16 }) {
			return h(
				"svg",
				{ width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": true },
				h("path", {
					d: "M4 19.5V16L16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-3 .5Z",
					stroke: "currentColor",
					strokeWidth: 1.7,
					strokeLinejoin: "round",
				}),
				h("path", { d: "M13.5 6.5l3 3", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" }),
			);
		}

		/**
		 * A disclosure chevron.
		 * @param props - `open`.
		 * @returns the SVG.
		 */
		function Chevron({ open }) {
			return h(
				"svg",
				{ width: 12, height: 12, viewBox: "0 0 24 24", fill: "none", "aria-hidden": true },
				h("path", {
					d: open ? "M6 15l6-6 6 6" : "M9 6l6 6-6 6",
					stroke: "currentColor",
					strokeWidth: 2,
					strokeLinecap: "round",
					strokeLinejoin: "round",
				}),
			);
		}

		/**
		 * A success check.
		 * @returns the SVG.
		 */
		function CheckIcon() {
			return h(
				"svg",
				{ width: 12, height: 12, viewBox: "0 0 24 24", fill: "none", "aria-hidden": true },
				h("path", {
					d: "M4 12.5l5 5L20 6.5",
					stroke: "currentColor",
					strokeWidth: 2,
					strokeLinecap: "round",
					strokeLinejoin: "round",
				}),
			);
		}

		// ── shared views ────────────────────────────────────────────────────

		/**
		 * Loading placeholder.
		 * @param props - translate.
		 * @returns the line.
		 */
		function Loading({ t }) {
			return h("div", { className: "dshEnglishCoach_loading" }, t("common.loading"));
		}

		/**
		 * Failure box with a retry.
		 * @param props - translate, error, retry.
		 * @returns the box.
		 */
		function ErrorBox({ t, error, onRetry }) {
			const message = String(error?.message ?? error);
			return h(
				"div",
				{ className: "dshEnglishCoach_error" },
				h("span", {}, t("common.error", { message })),
				h("button", { type: "button", className: "dshEnglishCoach_button dshEnglishCoach_buttonGhost", onClick: onRetry }, t("common.retry")),
			);
		}

		/**
		 * One issue row in a review card.
		 * @param props - translate, review, issue, index, compact, changed callback.
		 * @returns the row.
		 */
		function IssueRow({ t, review, issue, index, compact, onChanged }) {
			const [busy, setBusy] = useState(false);
			const act = async (action) => {
				if (busy) return;
				setBusy(true);
				try {
					await apiPost("issues", { reviewId: review.id, index, action });
					onChanged?.();
				} catch {
					// The next refresh will show the stored truth; a failure here is not worth a dialog.
				} finally {
					setBusy(false);
				}
			};
			return h(
				"li",
				{ className: "dshEnglishCoach_issue" },
				h("span", { className: "dshEnglishCoach_chip" }, t(`category.${issue.category}`)),
				h("span", { className: "dshEnglishCoach_before" }, issue.before),
				h("span", { className: "dshEnglishCoach_arrow" }, "→"),
				h("span", { className: "dshEnglishCoach_after" }, issue.after),
				issue.note ? h("span", { className: "dshEnglishCoach_note" }, issue.note) : null,
				compact
					? null
					: h(
							"span",
							{ className: "dshEnglishCoach_actions" },
							issue.mastered
								? null
								: h("button", { type: "button", className: "dshEnglishCoach_link", disabled: busy, onClick: () => act("master") }, t("notebook.master")),
							h("button", { type: "button", className: "dshEnglishCoach_link", disabled: busy, onClick: () => act("dismiss") }, t("notebook.dismiss")),
						),
			);
		}

		/**
		 * One reviewed message.
		 * @param props - translate, review, compact, changed callback.
		 * @returns the card.
		 */
		function ReviewCard({ t, review, compact, onChanged }) {
			const issues = (review.issues ?? []).filter((issue) => issue?.dismissed !== true);
			const corrected = typeof review.corrected === "string" && review.corrected.length > 0 && review.corrected !== review.text;
			return h(
				"article",
				{ className: "dshEnglishCoach_review" },
				h(
					"div",
					{ className: "dshEnglishCoach_reviewMeta" },
					h("span", {}, formatDay(t, review.at)),
					h("span", {}, t("notebook.session", { id: String(review.sessionId ?? "").slice(-6) })),
					h("span", {}, t("notebook.issueCount", { count: issues.length })),
				),
				h("div", { className: "dshEnglishCoach_original" }, review.text),
				corrected ? h("div", { className: "dshEnglishCoach_corrected" }, h("span", { className: "dshEnglishCoach_correctedLabel" }, t("notebook.corrected")), review.corrected) : null,
				issues.length > 0
					? h(
							"ul",
							{ className: "dshEnglishCoach_issues" },
							(review.issues ?? []).map((issue, index) =>
								issue?.dismissed === true
									? null
									: h(IssueRow, { key: index, t, review, issue, index, compact, onChanged }),
							),
						)
					: null,
			);
		}

		/**
		 * Localized day label.
		 * @param t - translate.
		 * @param timestamp - epoch milliseconds.
		 * @returns the label.
		 */
		function formatDay(t, timestamp) {
			const date = new Date(Number(timestamp) || Date.now());
			const today = new Date();
			if (date.toDateString() === today.toDateString()) return t("notebook.today");
			return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
		}

		// ── panel tabs ──────────────────────────────────────────────────────

		/**
		 * Overview: totals, distribution, weekly trend, recent reviews.
		 * @param props - translate.
		 * @returns the tab.
		 */
		function OverviewTab({ t }) {
			const [state, reload] = useApi("stats", { weeks: 8 });
			if (state.status === "loading") return h(Loading, { t });
			if (state.status === "error") return h(ErrorBox, { t, error: state.error, onRetry: reload });
			const data = state.data;
			const totals = data.totals ?? { reviews: 0, issues: 0, density: 0, words: 0 };
			if ((totals.reviews ?? 0) === 0) {
				return h("div", { className: "dshEnglishCoach_empty" }, t("overview.empty"));
			}
			const categories = (data.byCategory ?? []).slice(0, 8);
			const maxCategory = Math.max(1, ...categories.map((entry) => entry.count));
			const weekly = data.weekly ?? [];
			const maxDensity = Math.max(1, ...weekly.map((week) => week.density));
			return h(
				"div",
				{ className: "dshEnglishCoach_stack" },
				h(
					"div",
					{ className: "dshEnglishCoach_stats" },
					statCard(t("overview.reviews"), totals.reviews),
					statCard(t("overview.issues"), totals.issues),
					statCard(t("overview.density"), totals.density),
					statCard(t("overview.words"), totals.words),
				),
				categories.length > 0
					? h(
							"section",
							{ className: "dshEnglishCoach_section" },
							h("h3", { className: "dshEnglishCoach_sectionTitle" }, t("overview.byCategory")),
							categories.map((entry) =>
								h(
									"div",
									{ key: entry.category, className: "dshEnglishCoach_barRow" },
									h("span", { className: "dshEnglishCoach_barLabel" }, t(`category.${entry.category}`)),
									h("span", { className: "dshEnglishCoach_barTrack" }, h("span", { className: "dshEnglishCoach_barFill", style: { width: `${(entry.count / maxCategory) * 100}%` } })),
									h("span", { className: "dshEnglishCoach_barValue" }, entry.count),
								),
							),
						)
					: null,
				weekly.length > 0
					? h(
							"section",
							{ className: "dshEnglishCoach_section" },
							h("h3", { className: "dshEnglishCoach_sectionTitle" }, t("overview.trend")),
							h(
								"div",
								{ className: "dshEnglishCoach_weeks" },
								weekly.map((week) =>
									h(
										"div",
										{ key: week.weekStart, className: "dshEnglishCoach_week", title: t("overview.week", { reviews: week.reviews, issues: week.issues }) },
										h("div", { className: "dshEnglishCoach_weekBar", style: { height: `${Math.max(3, (week.density / maxDensity) * 100)}%` } }),
										h("div", { className: "dshEnglishCoach_weekLabel" }, new Date(week.weekStart).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })),
									),
								),
							),
						)
					: null,
				(data.recent ?? []).length > 0
					? h(
							"section",
							{ className: "dshEnglishCoach_section" },
							h("h3", { className: "dshEnglishCoach_sectionTitle" }, t("overview.recent")),
							h(
								"div",
								{ className: "dshEnglishCoach_list" },
								(data.recent ?? []).map((review) => h(ReviewCard, { key: review.id, t, review, compact: true })),
							),
						)
					: null,
			);
		}

		/**
		 * One statistic card.
		 * @param label - visible label.
		 * @param value - number.
		 * @returns the card.
		 */
		function statCard(label, value) {
			return h(
				"div",
				{ className: "dshEnglishCoach_stat" },
				h("div", { className: "dshEnglishCoach_statValue" }, String(value ?? 0)),
				h("div", { className: "dshEnglishCoach_statLabel" }, label),
			);
		}

		/**
		 * Notebook: filters and reviewed messages.
		 * @param props - translate.
		 * @returns the tab.
		 */
		function NotebookTab({ t }) {
			const [query, setQuery] = useState("");
			const [category, setCategory] = useState("");
			const [applied, setApplied] = useState({ q: "", category: "" });
			const [state, reload] = useApi("reviews", {
				limit: 100,
				issues: 1,
				q: applied.q === "" ? undefined : applied.q,
				category: applied.category === "" ? undefined : applied.category,
			});
			const apply = () => setApplied({ q: query.trim(), category });
			const body =
				state.status === "loading" ? (
					h(Loading, { t })
				) : state.status === "error" ? (
					h(ErrorBox, { t, error: state.error, onRetry: reload })
				) : (state.data.items ?? []).length === 0 ? (
					h("div", { className: "dshEnglishCoach_empty" }, applied.q === "" && applied.category === "" ? t("notebook.empty") : t("notebook.noMatch"))
				) : (
					h(
						"div",
						{ className: "dshEnglishCoach_list" },
						(state.data.items ?? []).map((review) => h(ReviewCard, { key: review.id, t, review, onChanged: reload })),
					)
				);
			return h(
				"div",
				{},
				h(
					"div",
					{ className: "dshEnglishCoach_filters" },
					h("input", {
						className: "dshEnglishCoach_input",
						placeholder: t("notebook.search"),
						value: query,
						onChange: (event) => setQuery(event.target.value),
						onKeyDown: (event) => {
							if (event.key === "Enter") apply();
						},
					}),
					h("button", { type: "button", className: "dshEnglishCoach_button", onClick: apply }, t("notebook.apply")),
				),
				h(
					"div",
					{ className: "dshEnglishCoach_chips" },
					[["", t("notebook.all")], ...CATEGORIES.map((id) => [id, t(`category.${id}`)])].map(([id, label]) =>
						h(
							"button",
							{
								key: id === "" ? "all" : id,
								type: "button",
								className: `dshEnglishCoach_chipButton${category === id ? " dshEnglishCoach_chipButtonActive" : ""}`,
								onClick: () => setCategory(id),
							},
							label,
						),
					),
				),
				body,
				state.status === "ready" && state.data.hasMore ? h("div", { className: "dshEnglishCoach_limit" }, t("notebook.limit")) : null,
			);
		}

		/**
		 * One dictionary entry card.
		 * @param props - translate, entry, onToggleSaved.
		 * @returns the card.
		 */
		function WordCard({ t, entry, onToggleSaved }) {
			return h(
				"div",
				{ className: "dshEnglishCoach_wordCard" },
				h(
					"div",
					{ className: "dshEnglishCoach_wordHead" },
					h(
						"div",
						{},
						h("span", { className: "dshEnglishCoach_wordTerm" }, entry.term),
						entry.phonetic ? h("span", { className: "dshEnglishCoach_wordPhonetic" }, entry.phonetic) : null,
					),
					h(
						"button",
						{ type: "button", className: "dshEnglishCoach_button", onClick: onToggleSaved },
						entry.saved ? t("words.remove") : t("words.save"),
					),
				),
				entry.zh ? h("div", { className: "dshEnglishCoach_wordZh" }, entry.zh) : null,
				(entry.meanings ?? []).map((meaning, index) =>
					h(
						"div",
						{ key: index, className: "dshEnglishCoach_meaning" },
						meaning.partOfSpeech ? h("span", { className: "dshEnglishCoach_pos" }, meaning.partOfSpeech) : null,
						h(
							"ol",
							{ className: "dshEnglishCoach_defs" },
							(meaning.definitions ?? []).map((definition, definitionIndex) =>
								h(
									"li",
									{ key: definitionIndex },
									definition.definition,
									definition.example ? h("span", { className: "dshEnglishCoach_ex" }, definition.example) : null,
								),
							),
						),
					),
				),
				entry.source ? h("div", { className: "dshEnglishCoach_wordSource" }, t("words.source", { source: entry.source })) : null,
			);
		}

		/**
		 * Dictionary: lookup plus the saved wordbook.
		 * @param props - translate.
		 * @returns the tab.
		 */
		function WordsTab({ t }) {
			const [term, setTerm] = useState("");
			const [entry, setEntry] = useState(null);
			const [busy, setBusy] = useState(false);
			const [message, setMessage] = useState("");
			const [saved, reloadSaved] = useApi("words", { limit: 50 });
			const search = async () => {
				const value = term.trim();
				if (value === "" || busy) return;
				setBusy(true);
				setMessage("");
				try {
					const data = await apiGet("lookup", { term: value });
					setEntry(data.entry);
					reloadSaved();
				} catch {
					setEntry(null);
					setMessage(t("words.notFound", { term: value }));
				} finally {
					setBusy(false);
				}
			};
			const toggleSaved = async () => {
				if (entry === null) return;
				try {
					const data = await apiPost("words", { term: entry.term, saved: entry.saved !== true });
					setEntry(data.entry);
					reloadSaved();
				} catch {
					// Keep the card as-is; the next lookup will re-read the stored state.
				}
			};
			const savedItems = saved.status === "ready" ? saved.data.items ?? [] : [];
			return h(
				"div",
				{ className: "dshEnglishCoach_stack" },
				h(
					"div",
					{},
					h(
						"div",
						{ className: "dshEnglishCoach_wordForm" },
						h("input", {
							className: "dshEnglishCoach_input",
							placeholder: t("words.placeholder"),
							value: term,
							onChange: (event) => setTerm(event.target.value),
							onKeyDown: (event) => {
								if (event.key === "Enter") search();
							},
						}),
						h("button", { type: "button", className: "dshEnglishCoach_button", disabled: busy, onClick: search }, busy ? t("words.searching") : t("words.button")),
					),
					message !== "" ? h("div", { className: "dshEnglishCoach_empty" }, message) : null,
					entry !== null ? h(WordCard, { t, entry, onToggleSaved: toggleSaved }) : null,
				),
				h(
					"section",
					{ className: "dshEnglishCoach_section" },
					h("h3", { className: "dshEnglishCoach_sectionTitle" }, t("words.savedTitle")),
					savedItems.length === 0
						? h("div", { className: "dshEnglishCoach_empty" }, t("words.savedEmpty"))
						: h(
								"div",
								{ className: "dshEnglishCoach_savedList" },
								savedItems.map((item) =>
									h(
										"div",
										{ key: item.term, className: "dshEnglishCoach_savedItem" },
										h("span", { className: "dshEnglishCoach_savedTerm" }, item.term),
										item.phonetic ? h("span", { className: "dshEnglishCoach_savedZh" }, item.phonetic) : null,
										h("span", { className: "dshEnglishCoach_savedZh" }, item.zh ?? ""),
									),
								),
							),
				),
			);
		}

		/**
		 * Settings: the stored preferences and the exports.
		 * @param props - translate.
		 * @returns the tab.
		 */
		function SettingsTab({ t }) {
			const [state, reload] = useApi("meta");
			const [form, setForm] = useState(null);
			const [saved, setSaved] = useState(false);
			const [busy, setBusy] = useState(false);
			useEffect(() => {
				if (state.status === "ready") setForm(state.data.prefs);
			}, [state.status]);
			if (state.status === "loading") return h(Loading, { t });
			if (state.status === "error") return h(ErrorBox, { t, error: state.error, onRetry: reload });
			if (form === null) return h(Loading, { t });
			const update = (patch) => {
				setSaved(false);
				setForm((current) => ({ ...current, ...patch }));
			};
			const save = async () => {
				if (busy) return;
				setBusy(true);
				try {
					const data = await apiPost("prefs", form);
					setForm(data.prefs);
					setSaved(true);
				} catch {
					// Keep the form so the person can retry.
				} finally {
					setBusy(false);
				}
			};
			const meta = state.data;
			return h(
				"div",
				{ className: "dshEnglishCoach_settings" },
				h(
					"label",
					{ className: "dshEnglishCoach_checkboxRow" },
					h("input", { type: "checkbox", checked: form.enabled === true, onChange: (event) => update({ enabled: event.target.checked }) }),
					h("span", {}, h("span", { className: "dshEnglishCoach_fieldLabel" }, t("settings.enabled")), h("span", { className: "dshEnglishCoach_fieldHint" }, t("settings.enabledHint"))),
				),
				h(
					"label",
					{ className: "dshEnglishCoach_checkboxRow" },
					h("input", { type: "checkbox", checked: form.quiet === true, onChange: (event) => update({ quiet: event.target.checked }) }),
					h("span", {}, h("span", { className: "dshEnglishCoach_fieldLabel" }, t("settings.quiet")), h("span", { className: "dshEnglishCoach_fieldHint" }, t("settings.quietHint"))),
				),
				h(
					"label",
					{ className: "dshEnglishCoach_checkboxRow" },
					h("input", { type: "checkbox", checked: form.showClean === true, onChange: (event) => update({ showClean: event.target.checked }) }),
					h("span", { className: "dshEnglishCoach_fieldLabel" }, t("settings.showClean")),
				),
				h(
					"label",
					{ className: "dshEnglishCoach_field" },
					h("span", { className: "dshEnglishCoach_fieldLabel" }, t("settings.level")),
					h(
						"select",
						{ className: "dshEnglishCoach_select", value: form.level, onChange: (event) => update({ level: event.target.value }) },
						["beginner", "intermediate", "advanced"].map((level) =>
							h("option", { key: level, value: level }, t(`settings.level.${level}`)),
						),
					),
				),
				h(
					"label",
					{ className: "dshEnglishCoach_field" },
					h("span", { className: "dshEnglishCoach_fieldLabel" }, t("settings.model")),
					h("input", {
						className: "dshEnglishCoach_input",
						value: form.coachModel ?? "",
						placeholder: "deepseek/deepseek-chat",
						onChange: (event) => update({ coachModel: event.target.value }),
					}),
					h("span", { className: "dshEnglishCoach_fieldHint" }, t("settings.modelHint")),
				),
				h(
					"label",
					{ className: "dshEnglishCoach_field" },
					h("span", { className: "dshEnglishCoach_fieldLabel" }, t("settings.minWords")),
					h("input", {
						className: "dshEnglishCoach_input",
						type: "number",
						min: 1,
						max: 60,
						value: form.minWords ?? 4,
						onChange: (event) => update({ minWords: Number(event.target.value) }),
					}),
				),
				h(
					"label",
					{ className: "dshEnglishCoach_field" },
					h("span", { className: "dshEnglishCoach_fieldLabel" }, t("settings.explainLocale")),
					h(
						"select",
						{ className: "dshEnglishCoach_select", value: form.explainLocale, onChange: (event) => update({ explainLocale: event.target.value }) },
						["zh", "en"].map((locale) => h("option", { key: locale, value: locale }, t(`settings.explainLocale.${locale}`))),
					),
				),
				h(
					"div",
					{ className: "dshEnglishCoach_footer" },
					h("button", { type: "button", className: "dshEnglishCoach_button", disabled: busy, onClick: save }, t("settings.save")),
					saved ? h("span", { className: "dshEnglishCoach_savedFlag" }, t("settings.saved")) : null,
				),
				h(
					"section",
					{ className: "dshEnglishCoach_section" },
					h("h3", { className: "dshEnglishCoach_sectionTitle" }, t("common.export")),
					h(
						"div",
						{ className: "dshEnglishCoach_exportRow" },
						h("a", { className: "dshEnglishCoach_exportLink", href: `${API}/export?format=md`, download: "english-coach.md" }, t("settings.export")),
						h("a", { className: "dshEnglishCoach_exportLink", href: `${API}/export?format=json`, download: "english-coach.json" }, t("settings.exportJson")),
					),
				),
				h(
					"div",
					{},
					h("div", { className: "dshEnglishCoach_privacy" }, t("settings.privacy")),
					h("div", { className: "dshEnglishCoach_fieldHint" }, t("settings.dataPath")),
					h("code", { className: "dshEnglishCoach_code" }, meta.dataPath ?? ""),
				),
			);
		}

		/**
		 * The page: header, tabs, and the selected tab.
		 * @param props - translate and panel helpers.
		 * @returns the page.
		 */
		function CoachPanel({ t }) {
			const [tab, setTab] = useState("overview");
			return h(
				"div",
				{ className: "dshEnglishCoach_page" },
				h(
					"header",
					{ className: "dshEnglishCoach_header" },
					h(
						"div",
						{ className: "dshEnglishCoach_heading" },
						h("div", { className: "dshEnglishCoach_title" }, t("panel.title")),
						h("div", { className: "dshEnglishCoach_subtitle" }, t("panel.subtitle")),
					),
					h(
						"nav",
						{ className: "dshEnglishCoach_tabs" },
						TABS.map(([id, label]) =>
							h(
								"button",
								{
									key: id,
									type: "button",
									className: `dshEnglishCoach_tab${tab === id ? " dshEnglishCoach_tabActive" : ""}`,
									onClick: () => setTab(id),
								},
								t(label),
							),
						),
					),
				),
				h(
					"div",
					{ className: "dshEnglishCoach_body" },
					tab === "overview"
						? h(OverviewTab, { t })
						: tab === "notebook"
							? h(NotebookTab, { t })
							: tab === "words"
								? h(WordsTab, { t })
								: h(SettingsTab, { t }),
				),
			);
		}

		// ── composer dock ───────────────────────────────────────────────────

		/**
		 * The latest review, in one line, above the composer.
		 * @param props - translate, session id, panel opener.
		 * @returns the strip, or null.
		 */
		function CoachDock({ t, sessionId, openPanel }) {
			const [state, setState] = useState(null);
			const [open, setOpen] = useState(false);
			const [hidden, setHidden] = useState("");

			useEffect(() => {
				let alive = true;
				const controller = new AbortController();
				const read = async () => {
					if (typeof sessionId !== "string" || sessionId === "") return;
					try {
						const next = await apiGet("state", { sessionId }, controller.signal);
						if (alive) setState(next);
					} catch {
						// The host route may not be up yet, or the page is reconnecting.
					}
				};
				read();
				const timer = window.setInterval(() => {
					if (document.visibilityState === "visible") read();
				}, 3000);
				return () => {
					alive = false;
					controller.abort();
					window.clearInterval(timer);
				};
			}, [sessionId]);

			const latestId = state?.latest?.id;
			useEffect(() => {
				setOpen(false);
			}, [latestId]);

			if (typeof sessionId !== "string" || sessionId === "") return null;
			if (state === null) return null;
			if (state.enabled !== true || state.quiet === true) return null;
			if (state.pending === true) {
				return h(
					"div",
					{ className: "dshEnglishCoach_dock" },
					h(
						"div",
						{ className: "dshEnglishCoach_dockCard" },
						h(
							"div",
							{ className: "dshEnglishCoach_dockRow" },
							h("span", { className: "dshEnglishCoach_pulse" }),
							h("span", { className: "dshEnglishCoach_dockSummary", style: { color: "var(--dsw-alias-label-secondary)" } }, t("dock.checking")),
						),
					),
				);
			}
			const review = state.latest;
			if (review === null || review === undefined) return null;
			if (hidden === review.id) return null;
			const issues = (review.issues ?? []).filter((issue) => issue?.dismissed !== true);
			if (issues.length === 0 && state.showClean !== true) return null;
			const categories = [...new Set(issues.map((issue) => issue.category))]
				.slice(0, 3)
				.map((category) => t(`category.${category}`))
				.join(" · ");
			return h(
				"div",
				{ className: "dshEnglishCoach_dock" },
				h(
					"div",
					{ className: "dshEnglishCoach_dockCard" },
					h(
						"div",
						{ className: "dshEnglishCoach_dockRow" },
						h("span", { className: "dshEnglishCoach_dockIcon" }, issues.length > 0 ? h(CoachIcon, { size: 14 }) : h(CheckIcon)),
						h("span", { className: "dshEnglishCoach_dockSummary" }, issues.length > 0 ? t("dock.issues", { count: issues.length }) : t("dock.clean")),
						categories !== "" ? h("span", { className: "dshEnglishCoach_dockCats" }, categories) : null,
						h("span", { className: "dshEnglishCoach_dockSpacer" }),
						issues.length > 0
							? h(
									"button",
									{ type: "button", className: "dshEnglishCoach_dockButton", onClick: () => setOpen((value) => !value) },
									t(open ? "dock.collapse" : "dock.expand"),
								)
							: null,
						h("button", { type: "button", className: "dshEnglishCoach_dockButton", onClick: openPanel }, t("dock.open")),
						h("button", { type: "button", className: "dshEnglishCoach_dockButton", onClick: () => setHidden(review.id) }, t("dock.dismiss")),
					),
					open && issues.length > 0
						? h(
								"div",
								{ className: "dshEnglishCoach_dockBody" },
								issues.map((issue, index) =>
									h(
										"div",
										{ key: index, className: "dshEnglishCoach_dockIssue" },
										h("span", { className: "dshEnglishCoach_chip" }, t(`category.${issue.category}`)),
										h("span", { className: "dshEnglishCoach_before" }, issue.before),
										h("span", { className: "dshEnglishCoach_arrow" }, "→"),
										h("span", { className: "dshEnglishCoach_after" }, issue.after),
										issue.note ? h("span", { className: "dshEnglishCoach_dockNote" }, issue.note) : null,
									),
								),
							)
						: null,
				),
			);
		}

		// ── plugin ──────────────────────────────────────────────────────────

		/** Required client services. */
		const inject = ["slots", "locale", "layout"];

		/**
		 * Client plugin body: styles, dictionaries, the panel, and the dock.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "english-coach: dictionaries");
			ctx.effect(() => {
				const existing = document.querySelector('style[data-plugin="dsh-english-coach"]');
				if (existing !== null) existing.remove();
				const tag = document.createElement("style");
				tag.dataset.plugin = "dsh-english-coach";
				tag.textContent = stylesheet;
				document.head.appendChild(tag);
				return () => tag.remove();
			}, "english-coach: styles");

			const openPanel = () => {
				try {
					ctx.layout.selectPanel(PANEL_ID);
				} catch (error) {
					console.error("[english-coach] could not open the panel", error);
				}
			};

			ctx.slots.inject("sidebar.panellist", () =>
				ctx.slots.register(
					{
						name: "sidebar.panellist",
						id: PANEL_ID,
						order: 30,
						locale: NS,
						label: () => t("panel.name"),
					},
					CoachIcon,
				),
			);
			ctx.slots.inject("main", () =>
				ctx.slots.register(
					{
						name: "main",
						key: PANEL_ID,
						locale: NS,
					},
					CoachPanel,
				),
			);
			ctx.slots.inject("conversation.input.dock", () =>
				ctx.slots.register(
					{
						name: "conversation.input.dock",
						id: PANEL_ID,
						order: 20,
						locale: NS,
						inject: () => ({ openPanel }),
					},
					CoachDock,
				),
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
