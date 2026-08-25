export interface DictionaryEntry {
	id: string;
	name: string; // 显示名称，默认取文件名
	path: string; // 本地 .mdx 文件绝对路径
	enabled: boolean;
}

export interface RecordDefinition {
	dictName: string;
	headword: string;
	text: string; // 纯文本，导出 Word 用
	html: string; // 带排版的词条 HTML 片段，导出 HTML 列表用
	css: string; // 该词典自带样式
}

export interface VocabRecord {
	id: string;
	word: string; // 原文中被点击的表面形式，如 "observed"
	headword: string; // 命中的第一本词典给出的词条，如 "observe"
	definitions: RecordDefinition[]; // 每本命中的词典各一条，导出时按词典名分段
	sentence: string; // 单词所在的完整句子
	bookTitle: string;
	bookAuthor: string;
	notePath: string;
	createdAt: number;
}

export type ExportFieldKey =
	| "index"
	| "word"
	| "headword"
	| "sentence"
	| "definition"
	| "book"
	| "author"
	| "date";

export interface ExportFieldConfig {
	key: ExportFieldKey;
	label: string;
	enabled: boolean;
}

export type LookupTrigger = "dblclick" | "click" | "drag";
export type ExportFormat = "docx" | "html-list";

export interface NoteSyncSettings {
	enabled: boolean;
	folder: string;
}

export interface VocabPluginSettings {
	dictionaries: DictionaryEntry[];
	titleFrontmatterKey: string;
	authorFrontmatterKey: string;
	exportFolder: string; // 导出文件放在 vault 内哪个文件夹
	exportFormat: ExportFormat;
	exportFields: ExportFieldConfig[];
	fuzzyEditDistance: number;
	lookupTrigger: LookupTrigger;
	noteSync: NoteSyncSettings;
}

export const DEFAULT_EXPORT_FIELDS: ExportFieldConfig[] = [
	{ key: "index", label: "序号", enabled: true },
	{ key: "word", label: "原词", enabled: true },
	{ key: "sentence", label: "例句", enabled: true },
	{ key: "definition", label: "释义", enabled: true },
	{ key: "book", label: "书名", enabled: true },
	{ key: "author", label: "作者", enabled: false },
	{ key: "date", label: "查词时间", enabled: false },
	{ key: "headword", label: "词典命中词条", enabled: false },
];

export const DEFAULT_SETTINGS: VocabPluginSettings = {
	dictionaries: [],
	titleFrontmatterKey: "title",
	authorFrontmatterKey: "author",
	exportFolder: "生词本导出",
	exportFormat: "docx",
	exportFields: DEFAULT_EXPORT_FIELDS,
	fuzzyEditDistance: 2,
	lookupTrigger: "dblclick",
	noteSync: { enabled: false, folder: "生词记录" },
};
