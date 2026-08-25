import type { LookupFailure, LookupResult } from "./dictionaryManager";

const MATCH_LABEL: Record<LookupResult["matchType"], string> = {
	exact: "精确匹配",
	inflection: "词形还原",
	fuzzy: "推测匹配",
};

export interface PopupCallbacks {
	onUndo: () => void;
	onPickSuggestion: (headword: string) => void;
	onManualQuery: (headword: string) => void;
}

export interface DictResultEntry {
	dictName: string;
	result: LookupResult | null;
}

export class LookupPopup {
	private el: HTMLDivElement;
	private shadow: ShadowRoot;
	private removed = false;

	constructor(anchorRect: DOMRect, private callbacks: PopupCallbacks) {
		this.el = document.createElement("div");
		this.el.addClass("mdx-vocab-popup-host");
		document.body.appendChild(this.el);
		this.shadow = this.el.attachShadow({ mode: "open" });
		this.position(anchorRect);

		const onDocDown = (evt: MouseEvent) => {
			if (!this.el.contains(evt.target as Node)) this.close();
		};
		const onEsc = (evt: KeyboardEvent) => {
			if (evt.key === "Escape") this.close();
		};
		// 下一 tick 再挂监听，避免触发本次弹出的那次点击/双击立刻把自己关掉
		window.setTimeout(() => {
			document.addEventListener("mousedown", onDocDown);
			document.addEventListener("keydown", onEsc);
			this.cleanupListeners = () => {
				document.removeEventListener("mousedown", onDocDown);
				document.removeEventListener("keydown", onEsc);
			};
		}, 0);
	}

	private cleanupListeners: () => void = () => {};

	private position(rect: DOMRect) {
		const width = 380;
		const maxHeight = 420;
		let left = rect.left;
		let top = rect.bottom + 6;
		if (left + width > window.innerWidth - 12) left = Math.max(12, window.innerWidth - width - 12);
		if (top + maxHeight > window.innerHeight - 12) top = Math.max(12, rect.top - maxHeight - 6);

		Object.assign(this.el.style, {
			position: "fixed",
			left: `${left}px`,
			top: `${top}px`,
			width: `${width}px`,
			maxHeight: `${maxHeight}px`,
			zIndex: "9999",
		});
	}

	showLoading(word: string) {
		this.render(`<div class="mv-loading">正在查询「${escapeHtml(word)}」…</div>`);
	}

	showResults(word: string, entries: DictResultEntry[], recorded: boolean) {
		const hits = entries.filter((e) => e.result);
		const misses = entries.filter((e) => !e.result);
		const titleWord = hits[0]?.result?.headword ?? word;
		const singleDict = entries.length <= 1;

		// 不同词典各自的 CSS 常有同名的通用 class（.word / .table / .pos ...），
		// 拼进同一个 <style> 会互相覆盖（表现为你截图里那种"该隐藏的表格露出来了"）。
		// 所以每本词典的内容单独套一层嵌套 Shadow DOM 隔离，互不干扰，和 MDict 里每个词典面板天然独立一致。
		const sections = hits
			.map((e, i) => {
				const badge = MATCH_LABEL[e.result!.matchType];
				return `
					<div class="mv-dict-section">
						${singleDict ? "" : `<div class="mv-dict-name">${escapeHtml(e.dictName)} <span class="mv-badge">${badge}</span></div>`}
						<div class="mv-dict-entry" data-dict-index="${i}"></div>
					</div>
				`;
			})
			.join("");

		const missLine = misses.length
			? `<div class="mv-hint mv-miss-line">${misses.map((e) => escapeHtml(e.dictName)).join("、")}：未收录</div>`
			: "";

		this.render(`
			<div class="mv-header">
				<span class="mv-headword">${escapeHtml(titleWord)}</span>
				${singleDict && hits[0] ? `<span class="mv-badge">${MATCH_LABEL[hits[0].result!.matchType]}</span>` : ""}
				<button class="mv-close" data-act="close" title="关闭">×</button>
			</div>
			<div class="mv-body">${sections}${missLine}</div>
			<div class="mv-footer">
				${
					recorded
						? `<span class="mv-recorded">已记录 · <a href="#" data-act="undo">撤销</a></span>`
						: `<span class="mv-recorded mv-muted">未记录</span>`
				}
			</div>
		`);

		hits.forEach((e, i) => {
			const host = this.shadow.querySelector<HTMLElement>(`.mv-dict-entry[data-dict-index="${i}"]`);
			if (!host) return;
			const inner = host.attachShadow({ mode: "open" });
			inner.innerHTML = `<style>${e.result!.css}\n${DICT_SCOPE_OVERRIDE}</style><div class="mv-dict-inner">${e.result!.html}</div>`;
		});

		this.shadow.querySelector('[data-act="close"]')?.addEventListener("click", () => this.close());
		this.shadow.querySelector('[data-act="undo"]')?.addEventListener("click", (e) => {
			e.preventDefault();
			this.callbacks.onUndo();
			this.close();
		});
	}

	showFailure(failure: LookupFailure) {
		const items = failure.suggestions
			.map((s) => `<button class="mv-suggest" data-word="${escapeHtml(s)}">${escapeHtml(s)}</button>`)
			.join("");

		this.render(`
			<div class="mv-header">
				<span class="mv-headword">未查到「${escapeHtml(failure.word)}」</span>
				<button class="mv-close" data-act="close" title="关闭">×</button>
			</div>
			<div class="mv-body mv-fail-body">
				${
					failure.suggestions.length
						? `<div class="mv-hint">你是不是想查：</div><div class="mv-suggest-list">${items}</div>`
						: `<div class="mv-hint">词典里没有相近的词条。</div>`
				}
				<div class="mv-manual">
					<input type="text" class="mv-manual-input" placeholder="手动输入词典词条…" />
					<button class="mv-manual-btn" data-act="manual-query">查询</button>
				</div>
			</div>
		`);

		this.shadow.querySelector('[data-act="close"]')?.addEventListener("click", () => this.close());
		this.shadow.querySelectorAll<HTMLButtonElement>(".mv-suggest").forEach((btn) => {
			btn.addEventListener("click", () => this.callbacks.onPickSuggestion(btn.dataset.word ?? ""));
		});
		const input = this.shadow.querySelector<HTMLInputElement>(".mv-manual-input");
		const submit = () => {
			const v = input?.value.trim();
			if (v) this.callbacks.onManualQuery(v);
		};
		this.shadow.querySelector('[data-act="manual-query"]')?.addEventListener("click", submit);
		input?.addEventListener("keydown", (e) => {
			if (e.key === "Enter") submit();
		});
	}

	showError(message: string) {
		this.render(`
			<div class="mv-header">
				<span class="mv-headword">出错了</span>
				<button class="mv-close" data-act="close" title="关闭">×</button>
			</div>
			<div class="mv-body"><div class="mv-hint">${escapeHtml(message)}</div></div>
		`);
		this.shadow.querySelector('[data-act="close"]')?.addEventListener("click", () => this.close());
	}

	private render(bodyHtml: string) {
		this.shadow.innerHTML = `<style>${BASE_STYLE}</style><div class="mv-panel">${bodyHtml}</div>`;
	}

	close() {
		if (this.removed) return;
		this.removed = true;
		this.cleanupListeners();
		this.el.remove();
	}
}

function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

// 注入进每本词典自己的嵌套 shadow root：只负责"能选中/能复制/不能点出去"，
// 不覆盖词典自己的排版（display/color 等一律不碰）。
const DICT_SCOPE_OVERRIDE = `
:host { all: initial; display: block; }
* { user-select: text !important; -webkit-user-select: text !important; }
a, span[href] { cursor: text !important; }
`;

const BASE_STYLE = `
:host { all: initial; }
* { box-sizing: border-box; }
.mv-panel {
	font-family: var(--font-interface, sans-serif);
	background: var(--background-primary, #fff);
	color: var(--text-normal, #222);
	border: 1px solid var(--background-modifier-border, #ccc);
	border-radius: 8px;
	box-shadow: var(--shadow-l, 0 4px 16px rgba(0,0,0,.2));
	max-height: 420px;
	display: flex;
	flex-direction: column;
	font-size: 14px;
	line-height: 1.5;
}
.mv-header {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 10px;
	border-bottom: 1px solid var(--background-modifier-border, #ccc);
	flex-shrink: 0;
}
.mv-headword { font-weight: 600; font-size: 15px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mv-badge { font-size: 11px; color: var(--text-muted, #888); background: var(--background-secondary, #eee); padding: 2px 6px; border-radius: 4px; }
.mv-close { border: none; background: transparent; font-size: 18px; line-height: 1; cursor: pointer; color: var(--text-muted, #888); padding: 0 4px; }
.mv-close:hover { color: var(--text-normal, #222); }
.mv-body { padding: 10px; overflow-y: auto; }
.mv-body, .mv-body * {
	user-select: text !important;
	-webkit-user-select: text !important;
	cursor: text !important;
	pointer-events: auto;
}
.mv-dict-section { margin-bottom: 12px; }
.mv-dict-section:last-child { margin-bottom: 0; }
.mv-dict-name {
	font-size: 12px;
	font-weight: 600;
	color: var(--text-accent, #7b6cd9);
	margin-bottom: 4px;
	padding-bottom: 3px;
	border-bottom: 1px dashed var(--background-modifier-border, #ccc);
}
.mv-miss-line { margin-top: 4px; margin-bottom: 0; font-size: 12px; }
.mv-footer { padding: 6px 10px; border-top: 1px solid var(--background-modifier-border, #ccc); font-size: 12px; flex-shrink: 0; }
.mv-recorded { color: var(--text-success, #2a2); }
.mv-recorded.mv-muted { color: var(--text-muted, #888); }
.mv-recorded a { color: var(--text-accent, #7b6cd9); cursor: pointer; margin-left: 4px; }
.mv-loading { padding: 16px; color: var(--text-muted, #888); text-align: center; }
.mv-hint { color: var(--text-muted, #888); margin-bottom: 8px; }
.mv-suggest-list { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.mv-suggest { border: 1px solid var(--background-modifier-border, #ccc); background: var(--background-secondary, #f3f3f3); border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 13px; }
.mv-suggest:hover { background: var(--background-modifier-hover, #e6e6e6); }
.mv-manual { display: flex; gap: 6px; }
.mv-manual-input { flex: 1; padding: 4px 6px; border: 1px solid var(--background-modifier-border, #ccc); border-radius: 4px; background: var(--background-primary, #fff); color: var(--text-normal, #222); }
.mv-manual-btn { border: none; background: var(--interactive-accent, #7b6cd9); color: var(--text-on-accent, #fff); border-radius: 4px; padding: 4px 10px; cursor: pointer; }
`;
