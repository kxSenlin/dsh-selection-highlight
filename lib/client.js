window.__ModuleLoader__.load({
	id: "dsh-selection-highlight",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/highlight.ts
		const DEFAULT_SCOPE_SELECTOR = "[data-conversation-scroll] [data-chat-flow]";
		const DEFAULT_SETTINGS = {
			enabled: true,
			ignoreCase: true,
			minLength: 4,
			scopeSelector: DEFAULT_SCOPE_SELECTOR
		};
		const SETTINGS_STORAGE_KEY = "dsh.selection-highlight.settings.v1";
		const HIGHLIGHT_NAME = "dsh-selection-highlight";
		const MAX_SELECTION_LENGTH = 128;
		const MAX_RANGES = 2e3;
		const MIN_LENGTH_MIN = 1;
		const MIN_LENGTH_MAX = 64;
		/** Selection must never start inside these editing surfaces. */
		const SELECTION_EXCLUDED = "input, textarea, [contenteditable=\"true\"], [contenteditable=\"\"]";
		/** Text nodes inside these surfaces never become highlight targets. */
		const SCAN_EXCLUDED = [
			"input",
			"textarea",
			"[contenteditable=\"true\"]",
			"[contenteditable=\"\"]",
			"[data-composer-seat]",
			"[data-streaming]",
			"[data-selection-highlight-ignore]"
		].join(", ");
		function clampMinLength(value) {
			if (typeof value === "number" && Number.isFinite(value)) return Math.min(MIN_LENGTH_MAX, Math.max(MIN_LENGTH_MIN, Math.round(value)));
			return DEFAULT_SETTINGS.minLength;
		}
		/** Merge untrusted stored values into a complete, valid settings object. */
		function normalizeSettings(partial) {
			const raw = partial ?? {};
			return {
				enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_SETTINGS.enabled,
				ignoreCase: typeof raw.ignoreCase === "boolean" ? raw.ignoreCase : DEFAULT_SETTINGS.ignoreCase,
				minLength: clampMinLength(raw.minLength),
				scopeSelector: typeof raw.scopeSelector === "string" && raw.scopeSelector.trim() !== "" ? raw.scopeSelector.trim() : DEFAULT_SCOPE_SELECTOR
			};
		}
		function loadSettings() {
			try {
				const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
				if (stored === null) return { ...DEFAULT_SETTINGS };
				return normalizeSettings(JSON.parse(stored));
			} catch {
				return { ...DEFAULT_SETTINGS };
			}
		}
		function saveSettings(settings) {
			try {
				localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
			} catch {}
		}
		function highlightRegistry() {
			if (typeof CSS === "undefined") return null;
			return CSS.highlights ?? null;
		}
		function createHighlight(ranges) {
			const HighlightCtor = globalThis.Highlight;
			if (HighlightCtor === void 0) return null;
			try {
				return new HighlightCtor(...ranges);
			} catch {
				return null;
			}
		}
		let highlightSupport;
		function isHighlightSupported() {
			highlightSupport ??= highlightRegistry() !== null && createHighlight([]) !== null;
			return highlightSupport;
		}
		function rangesOverlap(a, b) {
			if (a.startContainer === a.endContainer && b.startContainer === b.endContainer && a.startContainer === b.startContainer) return a.startOffset < b.endOffset && a.endOffset > b.startOffset;
			const aEndsBeforeBStarts = a.compareBoundaryPoints(Range.END_TO_START, b) <= 0;
			const aStartsAfterBEnds = a.compareBoundaryPoints(Range.START_TO_END, b) >= 0;
			return !aEndsBeforeBStarts && !aStartsAfterBEnds;
		}
		function elementOf(node) {
			return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
		}
		var SelectionHighlightController = class {
			settings;
			timer;
			observer;
			showing = false;
			subscribers = /* @__PURE__ */ new Set();
			constructor() {
				this.settings = loadSettings();
			}
			getSettings() {
				return { ...this.settings };
			}
			setSettings(patch) {
				this.settings = normalizeSettings({
					...this.settings,
					...patch
				});
				saveSettings(this.settings);
				if (!this.settings.enabled) this.clearHighlights();
				for (const listener of this.subscribers) listener();
				this.schedule(60);
			}
			subscribe(listener) {
				this.subscribers.add(listener);
				return () => {
					this.subscribers.delete(listener);
				};
			}
			start() {
				document.addEventListener("selectionchange", this.handleSelectionChange, true);
				document.addEventListener("keydown", this.handleKeyDown, true);
				if (typeof MutationObserver !== "undefined") {
					this.observer = new MutationObserver(this.handleMutation);
					this.observer.observe(document.documentElement, {
						subtree: true,
						childList: true,
						characterData: true
					});
				}
				ensureHighlightStyle();
			}
			dispose() {
				document.removeEventListener("selectionchange", this.handleSelectionChange, true);
				document.removeEventListener("keydown", this.handleKeyDown, true);
				this.observer?.disconnect();
				this.observer = void 0;
				if (this.timer !== void 0) {
					window.clearTimeout(this.timer);
					this.timer = void 0;
				}
				this.clearHighlights();
				removeHighlightStyle();
			}
			handleSelectionChange = () => {
				this.schedule(60);
			};
			handleKeyDown = (event) => {
				if (event.key === "Escape") this.clearHighlights();
			};
			handleMutation = () => {
				if (!this.showing) return;
				this.clearHighlights();
				this.schedule(200);
			};
			schedule(delay) {
				if (this.timer !== void 0) window.clearTimeout(this.timer);
				this.timer = window.setTimeout(() => {
					this.timer = void 0;
					this.reconcile();
				}, delay);
			}
			reconcile() {
				this.clearHighlights();
				if (!this.settings.enabled || !isHighlightSupported()) return;
				const selection = this.readSelection();
				if (selection === null) return;
				const ranges = this.collectRanges(selection);
				if (ranges.length === 0) return;
				const registry = highlightRegistry();
				const highlight = registry === null ? null : createHighlight(ranges);
				if (registry === null || highlight === null) return;
				try {
					registry.set(HIGHLIGHT_NAME, highlight);
					this.showing = true;
				} catch {
					this.showing = false;
				}
			}
			readSelection() {
				const selection = window.getSelection();
				if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null;
				const selectionRange = selection.getRangeAt(0);
				const text = selection.toString().trim();
				if (text.length < this.settings.minLength || text.length > MAX_SELECTION_LENGTH) return null;
				if (/[\r\n]/.test(text)) return null;
				if (this.isInsideExcluded(selectionRange.startContainer) || this.isInsideExcluded(selectionRange.endContainer)) return null;
				const scope = this.resolveScopeForNode(selectionRange.commonAncestorContainer);
				if (scope === null) return null;
				return {
					text,
					selectionRange,
					scope
				};
			}
			resolveScopeForNode(node) {
				const element = elementOf(node);
				if (element === null) return null;
				let roots;
				try {
					roots = document.querySelectorAll(this.settings.scopeSelector);
				} catch {
					return null;
				}
				for (const root of roots) if (root.isConnected && root.contains(element)) return root;
				return null;
			}
			isInsideExcluded(node) {
				const element = elementOf(node);
				return element !== null && element.closest(SELECTION_EXCLUDED) !== null;
			}
			collectRanges(selection) {
				const ranges = [];
				const foldedNeedle = selection.text.toLowerCase();
				const needle = this.settings.ignoreCase && foldedNeedle.length === selection.text.length ? foldedNeedle : selection.text;
				if (needle.length === 0) return ranges;
				const walker = document.createTreeWalker(selection.scope, NodeFilter.SHOW_TEXT, { acceptNode: (node) => {
					if ((node.nodeValue ?? "").length === 0) return NodeFilter.FILTER_REJECT;
					const parent = elementOf(node);
					if (parent === null) return NodeFilter.FILTER_REJECT;
					if (parent.closest(SCAN_EXCLUDED) !== null) return NodeFilter.FILTER_REJECT;
					return NodeFilter.FILTER_ACCEPT;
				} });
				let node;
				while ((node = walker.nextNode()) !== null && ranges.length < MAX_RANGES) {
					const text = node.nodeValue ?? "";
					const foldedText = text.toLowerCase();
					const haystack = this.settings.ignoreCase && foldedText.length === text.length ? foldedText : text;
					let from = 0;
					while (from < text.length && ranges.length < MAX_RANGES) {
						const index = haystack.indexOf(needle, from);
						if (index < 0) break;
						const range = document.createRange();
						range.setStart(node, index);
						range.setEnd(node, index + needle.length);
						if (!rangesOverlap(range, selection.selectionRange)) ranges.push(range);
						from = index + needle.length;
					}
				}
				return ranges;
			}
			clearHighlights() {
				if (this.showing) {
					highlightRegistry()?.delete(HIGHLIGHT_NAME);
					this.showing = false;
				}
			}
		};
		let highlightStyleElement = null;
		const HIGHLIGHT_STYLE = [
			"::highlight(dsh-selection-highlight) {",
			"  background-color: rgba(96, 165, 250, 0.26);",
			"  border-radius: 2px;",
			"}"
		].join("\n");
		function ensureHighlightStyle() {
			if (highlightStyleElement !== null && highlightStyleElement.isConnected) return;
			highlightStyleElement = document.createElement("style");
			highlightStyleElement.setAttribute("data-plugin", "dsh-selection-highlight");
			highlightStyleElement.textContent = HIGHLIGHT_STYLE;
			document.head.append(highlightStyleElement);
		}
		function removeHighlightStyle() {
			highlightStyleElement?.remove();
			highlightStyleElement = null;
		}
		//#endregion
		//#region src/client/settings-panel.ts
		/**
		* Settings section: a small self-contained panel registered into dsh's
		* `settings.section` list slot. React is only a mount point; the panel body
		* is plain DOM so the plugin bundle stays independent of dsh's UI packages.
		*/
		const PANEL_CSS = `
.shl-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 4px;
  max-width: 760px;
  font-size: 13px;
  color: var(--dsw-alias-label-primary, #e5e7eb);
}
.shl-panel h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.shl-subtitle {
  margin: -8px 0 0;
  color: var(--dsw-alias-label-secondary, #9ca3af);
  line-height: 1.6;
}
.shl-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(148, 163, 184, 0.22));
  border-radius: 8px;
  background: var(--dsw-alias-bg-module-platform, rgba(148, 163, 184, 0.04));
}
.shl-row .meta {
  min-width: 0;
}
.shl-row .title {
  font-weight: 600;
}
.shl-row .desc {
  margin-top: 2px;
  color: var(--dsw-alias-label-secondary, #9ca3af);
  line-height: 1.5;
}
.shl-control {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
}
.shl-check {
  width: 16px;
  height: 16px;
  accent-color: rgb(59, 130, 246);
  cursor: pointer;
}
.shl-number {
  width: 76px;
  padding: 6px 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(148, 163, 184, 0.28));
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary, #e5e7eb);
  font: inherit;
}
.shl-selector {
  width: min(360px, 42vw);
  padding: 6px 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(148, 163, 184, 0.28));
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary, #e5e7eb);
  font: 12px ui-monospace, 'Cascadia Code', Consolas, monospace;
}
.shl-btn {
  flex: none;
  padding: 6px 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(148, 163, 184, 0.28));
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary, #e5e7eb);
  cursor: pointer;
  font: inherit;
}
.shl-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(148, 163, 184, 0.12));
}
.shl-status {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px dashed var(--dsw-alias-border-l2, rgba(148, 163, 184, 0.22));
  color: var(--dsw-alias-label-secondary, #9ca3af);
  line-height: 1.7;
}
.shl-status b {
  color: var(--dsw-alias-label-primary, #e5e7eb);
  font-weight: 600;
}
`;
		function el(tag, className, text) {
			const node = document.createElement(tag);
			if (className !== void 0) node.className = className;
			if (text !== void 0) node.textContent = text;
			return node;
		}
		function makeRow(title, description, control) {
			const row = el("div", "shl-row");
			const meta = el("div", "meta");
			meta.append(el("div", "title", title), el("div", "desc", description));
			row.append(meta, control);
			return row;
		}
		function checkboxRow(title, description, checked, onChange) {
			const input = el("input", "shl-check");
			input.type = "checkbox";
			input.checked = checked;
			input.addEventListener("change", () => {
				onChange(input.checked);
			});
			return makeRow(title, description, input);
		}
		function createSettingsPanel(controller) {
			const settings = controller.getSettings();
			const root = el("div", "shl-panel");
			const style = el("style");
			style.textContent = PANEL_CSS;
			root.append(style, el("h3", void 0, "选区高亮"), el("p", "shl-subtitle", "双击或拖选对话中的文本后，对话区域内相同的文本片段会以低一级背景淡高亮。按 Esc、点击空白处或切换会话即清除。"));
			const status = el("p", "shl-status");
			const enabledRow = checkboxRow("启用文本高亮", "关闭后立即清除当前高亮，且不再响应新的选区。", settings.enabled, (checked) => {
				controller.setSettings({ enabled: checked });
			});
			const ignoreCaseRow = checkboxRow("忽略大小写", "开启后 deepseek 与 DeepSeek 视为同一片段。", settings.ignoreCase, (checked) => {
				controller.setSettings({ ignoreCase: checked });
			});
			const minLengthInput = el("input", "shl-number");
			minLengthInput.type = "number";
			minLengthInput.min = "1";
			minLengthInput.max = "64";
			minLengthInput.value = String(settings.minLength);
			minLengthInput.addEventListener("change", () => {
				const value = Number.parseInt(minLengthInput.value, 10);
				if (Number.isFinite(value)) controller.setSettings({ minLength: value });
				else minLengthInput.value = String(controller.getSettings().minLength);
			});
			const minLengthRow = makeRow("最少字符数", "短于该长度的选中内容不触发高亮，默认 4。", minLengthInput);
			const selectorInput = el("input", "shl-selector");
			selectorInput.type = "text";
			selectorInput.value = settings.scopeSelector;
			selectorInput.placeholder = DEFAULT_SCOPE_SELECTOR;
			selectorInput.spellcheck = false;
			selectorInput.addEventListener("change", () => {
				const value = selectorInput.value.trim() || "[data-conversation-scroll] [data-chat-flow]";
				selectorInput.value = value;
				controller.setSettings({ scopeSelector: value });
				refreshStatus();
			});
			const resetButton = el("button", "shl-btn", "恢复默认");
			resetButton.type = "button";
			resetButton.addEventListener("click", () => {
				controller.setSettings({
					enabled: true,
					ignoreCase: true,
					minLength: 4,
					scopeSelector: DEFAULT_SCOPE_SELECTOR
				});
				enabledRow.querySelector("input").checked = true;
				ignoreCaseRow.querySelector("input").checked = true;
				minLengthInput.value = "4";
				selectorInput.value = DEFAULT_SCOPE_SELECTOR;
				refreshStatus();
			});
			const selectorControl = el("div", "shl-control");
			selectorControl.append(selectorInput, resetButton);
			const selectorRow = makeRow("对话区域 CSS 选择器", "dsh 改版后可手动指定消息容器。默认值对应当前会话列的消息流。", selectorControl);
			const refreshStatus = () => {
				const supported = isHighlightSupported();
				const selector = selectorInput.value.trim() || "[data-conversation-scroll] [data-chat-flow]";
				let scopeCount = -1;
				try {
					scopeCount = document.querySelectorAll(selector).length;
				} catch {
					scopeCount = -1;
				}
				status.replaceChildren();
				status.append(el("b", void 0, supported ? "引擎可用" : "引擎不可用"), document.createTextNode(supported ? "（CSS Custom Highlight API；不改动页面 DOM，不会干扰 React 渲染）。" : "（当前浏览器缺少 CSS Custom Highlight API，建议使用最新版 Edge/WebView2）。"), document.createTextNode(" 目标范围："), el("b", void 0, scopeCount < 0 ? "选择器无效" : `${scopeCount} 个容器`), document.createTextNode("。"));
			};
			root.append(enabledRow, ignoreCaseRow, minLengthRow, selectorRow, status);
			refreshStatus();
			return {
				root,
				dispose: () => {
					root.remove();
				}
			};
		}
		function createSettingsSectionComponent(controller) {
			return function SelectionHighlightSection() {
				const hostRef = (0, react.useRef)(null);
				(0, react.useEffect)(() => {
					const host = hostRef.current;
					if (host === null) return void 0;
					const panel = createSettingsPanel(controller);
					host.append(panel.root);
					return panel.dispose;
				}, []);
				return (0, react.createElement)("div", { ref: hostRef });
			};
		}
		//#endregion
		//#region src/client/index.ts
		/**
		* dsh-selection-highlight — browser half.
		*
		* Two contributions:
		* 1. A document-level selection/highlight engine (no dependency on dsh's
		*    runtime services, so it also works while the app is still booting).
		* 2. One `settings.section` entry owning the feature's settings UI.
		*/
		const name = "dsh-selection-highlight";
		const inject = ["slots"];
		function apply(ctx) {
			const controller = new SelectionHighlightController();
			ctx.effect(() => {
				controller.start();
				return () => {
					controller.dispose();
				};
			}, "selection-highlight: selection engine");
			const Section = createSettingsSectionComponent(controller);
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "selection-highlight",
				order: 40,
				label: () => "选区高亮"
			}, Section));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map