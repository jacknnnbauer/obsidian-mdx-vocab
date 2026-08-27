import { FileSystemAdapter, MarkdownView, Notice, Plugin, TFile, normalizePath } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import { DictionaryManager } from "./dictionaryManager";
import { buildVocabDocx } from "./exportDocx";
import { buildVocabHtmlList } from "./exportHtml";
import { getElectronRemote } from "./electronRemote";
import { escapeHtml, nl2br } from "./exportShared";
import { htmlToPlainText } from "./htmlToText";
import { DictResultEntry, LookupPopup } from "./lookupPopup";
import { extractContext } from "./sentenceExtractor";
import { DEFAULT_SETTINGS, RecordDefinition, VocabPluginSettings, VocabRecord } from "./types";
import { VocabSettingTab } from "./settings";
import { wordRangeAtPoint } from "./wordAtPoint";

const IGNORE_CLICK_TARGET = "a, input, textarea, button, .task-list-item-checkbox, .cm-hashtag, .metadata-container";

interface PluginData {
	settings: VocabPluginSettings;
	records: VocabRecord[];
}

interface FileMeta {
	title: string;
	author: string;
	path: string;
}

export default class VocabPlugin extends Plugin {
	settings: VocabPluginSettings = DEFAULT_SETTINGS;
	records: VocabRecord[] = [];
	private dict = new DictionaryManager();
	private lastRecordId: string | null = null;
	private activeListeners: { type: string; fn: EventListener }[] = [];

	async onload() {
		await this.loadPluginData();
		this.addSettingTab(new VocabSettingTab(this.app, this));

		this.reloadDictionaries();

		this.bindTriggers();

		this.addCommand({
			id: "lookup-selection",
			name: "查询选中/光标处的单词",
			callback: () => {
				const sel = window.getSelection();
				if (!sel || sel.toString().trim() === "") {
					new Notice("请先在正文中选中一个单词");
					return;
				}
				this.runLookup(sel.getRangeAt(0), sel.toString());
			},
		});

		this.addCommand({
			id: "export-docx",
			name: "导出生词本",
			callback: () => this.exportVocab(),
		});
	}

	onunload() {
		this.unbindTriggers();
	}

	/** 按 settings.dictionaries 重新加载全部已启用的词典，未启用/已删除的会被卸载 */
	reloadDictionaries(): { id: string; name: string; ok: boolean; entryCount?: number; error?: string }[] {
		const results: { id: string; name: string; ok: boolean; entryCount?: number; error?: string }[] = [];
		const wanted = new Set(this.settings.dictionaries.filter((d) => d.enabled).map((d) => d.id));

		for (const id of this.dict.loadedIds) {
			if (!wanted.has(id)) this.dict.unload(id);
		}

		for (const entry of this.settings.dictionaries) {
			if (!entry.enabled) continue;
			const r = this.dict.load(entry.id, entry.path);
			if (r.ok) results.push({ id: entry.id, name: entry.name, ok: true, entryCount: r.entryCount });
			else results.push({ id: entry.id, name: entry.name, ok: false, error: r.error });
		}
		return results;
	}

	/** 设置里切换查词触发方式时调用，换一套 DOM 监听 */
	rebindTriggers() {
		this.bindTriggers();
	}

	private bindTriggers() {
		this.unbindTriggers();
		const mode = this.settings.lookupTrigger;

		if (mode === "dblclick") {
			this.addListener("dblclick", (evt) => this.handleDblClick(evt as MouseEvent));
		} else if (mode === "click") {
			this.addListener("click", (evt) => this.handleSingleClick(evt as MouseEvent));
		} else if (mode === "drag") {
			this.addListener("mouseup", (evt) => this.handleDragSelect(evt as MouseEvent));
		}
	}

	private addListener(type: string, fn: EventListener) {
		document.addEventListener(type, fn);
		this.activeListeners.push({ type, fn });
	}

	private unbindTriggers() {
		for (const { type, fn } of this.activeListeners) document.removeEventListener(type, fn);
		this.activeListeners = [];
	}

	private isInsideMarkdownView(evt: MouseEvent): boolean {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return false;
		return evt.target instanceof Node && view.containerEl.contains(evt.target);
	}

	private handleDblClick(evt: MouseEvent) {
		if (!this.isInsideMarkdownView(evt)) return;
		window.setTimeout(() => {
			const sel = window.getSelection();
			if (!sel || sel.isCollapsed || sel.toString().trim() === "") return;
			this.runLookup(sel.getRangeAt(0), sel.toString());
		}, 0);
	}

	private handleSingleClick(evt: MouseEvent) {
		if (evt.detail > 1) return; // 双击的第二下 click 事件 detail 会是 2，交给原生词选择逻辑，不重复触发
		if (evt.button !== 0 || evt.ctrlKey || evt.metaKey || evt.altKey || evt.shiftKey) return;
		if (!this.isInsideMarkdownView(evt)) return;
		if (evt.target instanceof HTMLElement && evt.target.closest(IGNORE_CLICK_TARGET)) return;

		const range = wordRangeAtPoint(evt.clientX, evt.clientY);
		if (!range) return;
		const word = range.toString();
		if (!word) return;
		this.runLookup(range, word);
	}

	private handleDragSelect(evt: MouseEvent) {
		if (!this.isInsideMarkdownView(evt)) return;
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed) return;
		const text = sel.toString();
		if (!text.trim() || /\n/.test(text) || text.length > 60) return;
		this.runLookup(sel.getRangeAt(0), text);
	}

	private enabledDictionaries() {
		return this.settings.dictionaries.filter((d) => d.enabled && this.dict.isLoaded(d.id));
	}

	private runLookup(range: Range, rawWord: string) {
		if (this.enabledDictionaries().length === 0) {
			new Notice("还没有已加载的词典，请到插件设置里添加/启用至少一本 .mdx 词典");
			return;
		}
		const word = rawWord.trim();
		if (!word || word.length > 40) return;

		const rect = range.getBoundingClientRect();
		const context = extractContext(range);
		const sentence = context?.sentence ?? "";

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const meta = this.getFileMeta(view?.file ?? null);

		const popup = new LookupPopup(rect, {
			onUndo: () => this.undoLastRecord(),
			onPickSuggestion: (headword) => this.runManualLookup(popup, headword, word, sentence, meta),
			onManualQuery: (headword) => this.runManualLookup(popup, headword, word, sentence, meta),
		});
		popup.showLoading(word);
		this.performLookup(popup, word, sentence, meta);
	}

	private getFileMeta(file: TFile | null): FileMeta {
		if (!file) return { title: "", author: "", path: "" };
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
		const titleKey = this.settings.titleFrontmatterKey;
		const authorKey = this.settings.authorFrontmatterKey;
		const title = (titleKey && fm[titleKey]) || file.basename;
		const author = (authorKey && fm[authorKey]) || "";
		return { title: String(title), author: String(author), path: file.path };
	}

	private lookupAcrossDicts(word: string): { entries: DictResultEntry[]; suggestions: string[] } {
		const dicts = this.enabledDictionaries();
		const entries: DictResultEntry[] = [];
		const allSuggestions: string[] = [];

		for (const d of dicts) {
			try {
				const r = this.dict.lookupIn(d.id, word, this.settings.fuzzyEditDistance);
				if ("suggestions" in r) {
					entries.push({ dictName: d.name, result: null });
					allSuggestions.push(...r.suggestions);
				} else {
					entries.push({ dictName: d.name, result: r });
				}
			} catch {
				entries.push({ dictName: d.name, result: null });
			}
		}
		return { entries, suggestions: dedupe(allSuggestions) };
	}

	private performLookup(popup: LookupPopup, word: string, sentence: string, meta: FileMeta) {
		const { entries, suggestions } = this.lookupAcrossDicts(word);

		const hasHit = entries.some((e) => e.result);
		if (!hasHit) {
			popup.showFailure({ word, suggestions: suggestions.slice(0, 8) });
			return;
		}

		this.addRecord(word, entries, sentence, meta);
		popup.showResults(word, entries, true);
	}

	private runManualLookup(popup: LookupPopup, headword: string, surfaceWord: string, sentence: string, meta: FileMeta) {
		const dicts = this.enabledDictionaries();
		const entries: DictResultEntry[] = dicts.map((d) => ({
			dictName: d.name,
			result: this.dict.lookupExactIn(d.id, headword),
		}));

		if (!entries.some((e) => e.result)) {
			popup.showError(`词典里没有「${headword}」这个词条`);
			return;
		}

		this.addRecord(surfaceWord, entries, sentence, meta);
		popup.showResults(surfaceWord, entries, true);
	}

	private addRecord(surfaceWord: string, entries: DictResultEntry[], sentence: string, meta: FileMeta) {
		const hits = entries.filter((e) => e.result);
		const definitions: RecordDefinition[] = hits.map((e) => ({
			dictName: e.dictName,
			headword: e.result!.headword,
			text: e.result!.plainText,
			html: e.result!.html,
			css: e.result!.css,
		}));

		const record: VocabRecord = {
			id: makeId(),
			word: surfaceWord,
			headword: definitions[0]?.headword ?? surfaceWord,
			definitions,
			sentence,
			bookTitle: meta.title,
			bookAuthor: meta.author,
			notePath: meta.path,
			createdAt: Date.now(),
		};
		this.records.push(record);
		this.lastRecordId = record.id;
		void this.savePluginData();
		void this.syncToNote(record);
	}

	async deleteRecord(id: string) {
		this.records = this.records.filter((r) => r.id !== id);
		await this.savePluginData();
	}

	/**
	 * 把某条记录的"原词"改成 newWord 并重新查一遍——用于点错词形（比如查到了 opposed
	 * 但其实想学的是 oppose）之后纠正。查不到的话仍然改文字，但保留原来的释义不动。
	 */
	async relookupRecord(id: string, newWord: string): Promise<{ ok: boolean; message: string }> {
		const record = this.records.find((r) => r.id === id);
		if (!record) return { ok: false, message: "记录不存在" };

		const trimmed = newWord.trim();
		if (!trimmed) return { ok: false, message: "单词不能为空" };

		record.word = trimmed;

		if (this.enabledDictionaries().length === 0) {
			await this.savePluginData();
			return { ok: false, message: "没有已加载的词典，仅更新了显示文字" };
		}

		const { entries, suggestions } = this.lookupAcrossDicts(trimmed);
		const hits = entries.filter((e) => e.result);
		if (hits.length === 0) {
			await this.savePluginData();
			const hint = suggestions.length > 0 ? `，相近词条：${suggestions.slice(0, 5).join("、")}` : "";
			return { ok: false, message: `词典里没有「${trimmed}」这个词条${hint}，仅更新了显示文字` };
		}

		const definitions: RecordDefinition[] = hits.map((e) => ({
			dictName: e.dictName,
			headword: e.result!.headword,
			text: e.result!.plainText,
			html: e.result!.html,
			css: e.result!.css,
		}));
		record.headword = definitions[0].headword;
		record.definitions = definitions;
		await this.savePluginData();
		return { ok: true, message: `已更新为「${trimmed}」的释义` };
	}

	/** 用已存的 html+css 重新生成每条记录的纯文本释义（Word 导出用的那个字段） */
	async regenerateDefinitionText(): Promise<number> {
		let changed = 0;
		for (const r of this.records) {
			for (const d of r.definitions) {
				if (!d.html) continue;
				const fresh = htmlToPlainText(d.html, d.css);
				if (fresh !== d.text) {
					d.text = fresh;
					changed++;
				}
			}
		}
		if (changed > 0) await this.savePluginData();
		return changed;
	}

	private async syncToNote(record: VocabRecord) {
		if (!this.settings.noteSync.enabled) return;

		const folder = normalizePath(this.settings.noteSync.folder || "生词记录");
		if (!(await this.app.vault.adapter.exists(folder))) {
			await this.app.vault.createFolder(folder);
		}

		const title = record.bookTitle || "未命名";
		const notePath = normalizePath(`${folder}/${sanitizeFilename(title)}.md`);
		const existingFile = this.app.vault.getAbstractFileByPath(notePath);

		const entry = [
			`### ${record.word}`,
			"",
			record.sentence,
			"",
			new Date(record.createdAt).toLocaleString(),
			"",
			"---",
			"",
		].join("\n");

		if (existingFile instanceof TFile) {
			const existing = await this.app.vault.read(existingFile);
			await this.app.vault.modify(existingFile, existing + entry);
		} else {
			const authorLine = record.bookAuthor ? `作者：${record.bookAuthor}\n\n` : "";
			const header = `# ${title}\n\n${authorLine}---\n\n`;
			await this.app.vault.create(notePath, header + entry);
		}
	}

	private undoLastRecord() {
		if (!this.lastRecordId) return;
		this.records = this.records.filter((r) => r.id !== this.lastRecordId);
		this.lastRecordId = null;
		void this.savePluginData();
		new Notice("已撤销该条记录");
	}

	async clearRecords() {
		this.records = [];
		await this.savePluginData();
	}

	async exportVocab(recordIds?: string[]) {
		const records =
			recordIds && recordIds.length > 0 ? this.records.filter((r) => recordIds.includes(r.id)) : this.records;

		if (records.length === 0) {
			new Notice("生词本还是空的");
			return;
		}
		const folder = normalizePath(this.settings.exportFolder || "生词本导出");
		if (!(await this.app.vault.adapter.exists(folder))) {
			await this.app.vault.createFolder(folder);
		}

		const stamp = formatDate(new Date());
		const format = this.settings.exportFormat;
		const ext = format === "docx" ? "docx" : "html";
		const filename = `生词本-${stamp}.${ext}`;

		const adapter = this.app.vault.adapter;
		const defaultPath =
			adapter instanceof FileSystemAdapter ? path.join(adapter.getFullPath(folder), filename) : filename;

		const savePath = this.chooseSaveDestination(defaultPath, ext);
		if (!savePath) return; // 用户取消

		if (format === "docx") {
			const buf = await buildVocabDocx(records, this.settings.exportFields);
			fs.writeFileSync(savePath, Buffer.from(buf));
		} else {
			const html = buildVocabHtmlList(records, this.settings.exportFields);
			fs.writeFileSync(savePath, html, "utf-8");
		}
		new Notice(`已导出 ${records.length} 个单词到 ${savePath}`);
	}

	/** 弹原生保存对话框，默认定位到配置的导出文件夹；拿不到原生对话框时直接落到默认路径 */
	private chooseSaveDestination(defaultPath: string, ext: string): string | null {
		const electronRemote = getElectronRemote();
		if (!electronRemote?.dialog) return defaultPath;

		const result: string | undefined = electronRemote.dialog.showSaveDialogSync(electronRemote.getCurrentWindow?.(), {
			title: "导出生词本",
			defaultPath,
			filters: [{ name: ext === "docx" ? "Word 文档" : "HTML 文件", extensions: [ext] }],
		});
		return result ?? null;
	}

	private async loadPluginData() {
		const raw = ((await this.loadData()) ?? {}) as any;
		const rawSettings = raw.settings ?? {};

		// 迁移：旧版本是单本词典 dictPath: string，新版本是 dictionaries: DictionaryEntry[]
		let dictionaries = rawSettings.dictionaries;
		let migrated = false;
		if (!dictionaries && typeof rawSettings.dictPath === "string" && rawSettings.dictPath.trim()) {
			const p = rawSettings.dictPath.trim();
			dictionaries = [{ id: makeId(), name: baseNameNoExt(p), path: p, enabled: true }];
			migrated = true;
		}

		// 迁移：早期版本有过 "html-table" 这个导出格式，现在已经去掉了
		if (rawSettings.exportFormat === "html-table") {
			rawSettings.exportFormat = "html-list";
			migrated = true;
		}

		this.settings = {
			...DEFAULT_SETTINGS,
			...rawSettings,
			dictionaries: dictionaries ?? DEFAULT_SETTINGS.dictionaries,
		};

		// 迁移：旧版本每条记录是单一 definitionText: string，新版本是 definitions: RecordDefinition[]；
		// 中间还有一版 definitions[] 里没有 html/css（多词典功能刚上时），这里一起补全。
		const rawRecords = (raw.records ?? []) as any[];
		const fallbackDictName = this.settings.dictionaries[0]?.name ?? "词典";
		this.records = rawRecords.map((r) => {
			if (Array.isArray(r.definitions)) {
				const needsBackfill = r.definitions.some((d: any) => d.html === undefined);
				if (!needsBackfill) return r as VocabRecord;
				migrated = true;
				const definitions: RecordDefinition[] = r.definitions.map((d: any) => ({
					dictName: d.dictName,
					headword: d.headword,
					text: d.text ?? "",
					html: d.html ?? `<p>${nl2br(escapeHtml(d.text ?? ""))}</p>`,
					css: d.css ?? "",
				}));
				return { ...r, definitions } as VocabRecord;
			}
			migrated = true;
			const definitions: RecordDefinition[] = r.definitionText
				? [
						{
							dictName: fallbackDictName,
							headword: r.headword ?? r.word,
							text: r.definitionText,
							html: `<p>${nl2br(escapeHtml(r.definitionText))}</p>`,
							css: "",
						},
				  ]
				: [];
			const { definitionText, ...rest } = r;
			return { ...rest, definitions } as VocabRecord;
		});

		if (migrated) await this.savePluginData();
	}

	async saveSettings() {
		await this.savePluginData();
	}

	private async savePluginData() {
		const data: PluginData = { settings: this.settings, records: this.records };
		await this.saveData(data);
	}
}

function dedupe(list: string[]): string[] {
	return [...new Set(list)];
}

function sanitizeFilename(name: string): string {
	return name.replace(/[\\/:*?"<>|]/g, " ").trim().slice(0, 150) || "未命名";
}

function baseNameNoExt(p: string): string {
	const base = p.replace(/^.*[\\/]/, "");
	return base.replace(/\.mdx$/i, "");
}

function makeId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function formatDate(d: Date): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
