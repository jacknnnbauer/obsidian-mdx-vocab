import { ExportFieldConfig, VocabRecord } from "./types";
import { escapeHtml } from "./exportShared";

export function buildVocabHtmlList(records: VocabRecord[], fields: ExportFieldConfig[]): string {
	const enabledKeys = new Set(fields.filter((f) => f.enabled).map((f) => f.key));

	// 不同词典的 CSS 常有同名的通用 class（.word / .table ...），全局注入理论上有小概率互相覆盖，
	// 但导出文件不允许带 <script>（Obsidian 插件审核不允许动态构造 script 标签），
	// 所以这里不做每条释义单独用 Shadow DOM 隔离，直接把各词典的 CSS 去重后放进 <head>，
	// 效果等同于 MDict 里多个词典面板共享一个页面时的样子。
	const cssByDict = new Map<string, string>();
	for (const r of records) {
		for (const d of r.definitions) {
			if (!cssByDict.has(d.dictName)) cssByDict.set(d.dictName, d.css);
		}
	}
	const allDictCss = [...cssByDict.values()].join("\n");

	const items = records
		.map((r, i) => {
			const metaParts: string[] = [];
			if (enabledKeys.has("book") && r.bookTitle) {
				const authorPart = r.bookAuthor && enabledKeys.has("author") ? `（${escapeHtml(r.bookAuthor)}）` : "";
				metaParts.push(`《${escapeHtml(r.bookTitle)}》${authorPart}`);
			}
			if (enabledKeys.has("date")) metaParts.push(escapeHtml(new Date(r.createdAt).toLocaleString()));

			const multiDict = r.definitions.length > 1;
			const defBlocks = enabledKeys.has("definition")
				? r.definitions
						.map(
							(d) => `
								<div class="dict-block">
									${multiDict ? `<div class="dict-name">${escapeHtml(d.dictName)}</div>` : ""}
									<div class="dict-html">${d.html}</div>
								</div>
							`
						)
						.join("")
				: "";

			return `
				<div class="entry">
					<h3>${enabledKeys.has("index") ? `${i + 1}. ` : ""}${escapeHtml(r.word)}</h3>
					${enabledKeys.has("sentence") && r.sentence ? `<p class="sentence">${escapeHtml(r.sentence)}</p>` : ""}
					${metaParts.length ? `<p class="meta">${metaParts.join(" · ")}</p>` : ""}
					${defBlocks ? `<div class="definitions">${defBlocks}</div>` : ""}
				</div>
			`;
		})
		.join("\n");

	const body = `
		<h1>生词本</h1>
		<p class="meta">共 ${records.length} 个单词 · 导出于 ${new Date().toLocaleString()}</p>
		${items}
	`;

	return wrapHtmlDoc("生词本", body, `${LIST_STYLE}\n${allDictCss}`);
}

function wrapHtmlDoc(title: string, bodyHtml: string, styleContent: string): string {
	return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>${styleContent}</style>
</head>
<body>
<div class="mv-container">
${bodyHtml}
</div>
</body>
</html>`;
}

const BASE_STYLE = `
	:root { color-scheme: light; }
	* { box-sizing: border-box; }
	body {
		margin: 0;
		padding: 32px 16px;
		background: #f4f2ee;
		color: #2b2b2b;
		font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
		line-height: 1.6;
	}
	.mv-container { max-width: 860px; margin: 0 auto; background: #fff; padding: 32px 40px; border-radius: 10px; box-shadow: 0 2px 12px rgba(0,0,0,.06); }
	h1 { font-size: 22px; margin: 0 0 4px; }
	.meta { color: #888; font-size: 13px; margin: 0 0 24px; }
	@media print {
		body { background: #fff; padding: 0; }
		.mv-container { box-shadow: none; padding: 0; }
	}
`;

const LIST_STYLE = `${BASE_STYLE}
	.entry { padding: 20px 0; border-bottom: 1px solid #e8e5df; page-break-inside: avoid; }
	.entry:last-child { border-bottom: none; }
	.entry h3 { font-size: 19px; margin: 0 0 8px; color: #1f4e3d; }
	.entry .sentence { margin: 0 0 6px; padding-left: 12px; border-left: 3px solid #d8c9a3; color: #444; font-style: italic; }
	.entry .meta { margin: 0 0 12px; }
	.definitions { display: flex; flex-direction: column; gap: 10px; }
	.dict-block { background: #faf9f6; border: 1px solid #ece8e0; border-radius: 6px; padding: 10px 14px; }
	.dict-name { font-size: 12px; font-weight: 600; color: #a6813f; margin-bottom: 6px; }
	.dict-html { font-size: 14px; }
`;
