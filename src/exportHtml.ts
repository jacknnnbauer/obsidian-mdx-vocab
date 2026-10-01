import { ExportFieldConfig, HtmlExportTheme, VocabRecord } from "./types";
import { escapeHtml } from "./exportShared";

export function buildVocabHtmlList(
	records: VocabRecord[],
	fields: ExportFieldConfig[],
	theme: HtmlExportTheme = "warm"
): string {
	const enabledKeys = new Set(fields.filter((f) => f.enabled).map((f) => f.key));

	// 不同词典的 CSS 常有同名的通用 class（.word / .table ...），全局注入理论上有小概率互相覆盖，
	// 但导出文件里不放脚本标签（插件审核不允许动态构造这类标签），
	// 所以这里不做每条释义单独用 Shadow DOM 隔离，直接把各词典的 CSS 去重后放进 head 区域，
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

	return wrapHtmlDoc("生词本", body, `${THEME_STYLES[theme]}\n${allDictCss}`);
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

function baseStyle(pageBg: string, fontStack: string): string {
	return `
		:root { color-scheme: light; }
		* { box-sizing: border-box; }
		body {
			margin: 0;
			padding: 32px 16px;
			background: ${pageBg};
			color: #2b2b2b;
			font-family: ${fontStack};
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
}

// 暖色经典：原来就有的默认样式，米白底、暖棕色点缀。
const WARM_STYLE = `${baseStyle("#f4f2ee", '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif')}
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

// 钢蓝技术风：参照 md2pdf「工程文件·钢蓝」配色——深蓝灰标题、钢蓝分割线、浅蓝灰卡片，偏理工科的干净感。
const STEEL_STYLE = `${baseStyle("#eef1f4", '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif')}
	h1 { color: #1f2d3d; }
	.entry { padding: 20px 0; border-bottom: 1px solid #dde3ea; page-break-inside: avoid; }
	.entry:last-child { border-bottom: none; }
	.entry h3 { font-size: 19px; margin: 0 0 8px; color: #1f2d3d; border-bottom: 1.4px solid #2f4a68; padding-bottom: 6px; display: inline-block; }
	.entry .sentence { margin: 0 0 6px; padding-left: 12px; border-left: 3px solid #2f4a68; color: #445463; font-style: italic; }
	.entry .meta { margin: 0 0 12px; color: #7a8897; }
	.definitions { display: flex; flex-direction: column; gap: 10px; }
	.dict-block { background: #f3f6f9; border: 1px solid #c9d2dc; border-radius: 6px; padding: 10px 14px; }
	.dict-name { font-size: 12px; font-weight: 700; color: #2f4a68; margin-bottom: 6px; text-transform: uppercase; letter-spacing: .3px; }
	.dict-html { font-size: 14px; }
`;

// 国际双语风：参照 md2pdf「国际双语风」配色——深藏青标题、金色分割线，偏正式/双语词典的质感。
const NAVY_GOLD_STYLE = `${baseStyle("#f3f1e9", '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif')}
	h1 { color: #14264a; font-family: Georgia, "SimHei", serif; }
	.entry { padding: 20px 0; border-bottom: 1px solid #eae3cf; page-break-inside: avoid; }
	.entry:last-child { border-bottom: none; }
	.entry h3 { font-size: 19px; margin: 0 0 8px; color: #14264a; font-family: Georgia, "SimHei", serif; border-bottom: 1.5px solid #b8962e; padding-bottom: 6px; display: inline-block; }
	.entry .sentence { margin: 0 0 6px; padding-left: 12px; border-left: 3px solid #b8962e; color: #444; font-style: italic; }
	.entry .meta { margin: 0 0 12px; color: #8a8368; }
	.definitions { display: flex; flex-direction: column; gap: 10px; }
	.dict-block { background: #f8f5ec; border: 1px solid #ddd6c3; border-radius: 6px; padding: 10px 14px; }
	.dict-name { font-size: 12px; font-weight: 700; color: #b8962e; margin-bottom: 6px; text-transform: uppercase; letter-spacing: .3px; }
	.dict-html { font-size: 14px; }
`;

// 简约咨询风：参照 md2pdf「咨询报告」配色——墨绿底色标题、青色点缀，纯白底卡片，大留白、干净克制。
const CONSULT_STYLE = `${baseStyle("#f3f7f8", '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif')}
	h1 { color: #0b5563; }
	.entry { padding: 20px 0; border-bottom: 1px solid #d9e7e9; page-break-inside: avoid; }
	.entry:last-child { border-bottom: none; }
	.entry h3 { font-size: 19px; margin: 0 0 8px; color: #0b5563; border-bottom: 1.4px solid #0b8a8f; padding-bottom: 6px; display: inline-block; }
	.entry .sentence { margin: 0 0 6px; padding-left: 12px; border-left: 3px solid #0b8a8f; color: #445a5c; font-style: italic; }
	.entry .meta { margin: 0 0 12px; color: #6f8a8d; }
	.definitions { display: flex; flex-direction: column; gap: 10px; }
	.dict-block { background: #eef6f7; border: 1px solid #c8dde0; border-radius: 6px; padding: 10px 14px; }
	.dict-name { font-size: 12px; font-weight: 700; color: #0b8a8f; margin-bottom: 6px; text-transform: uppercase; letter-spacing: .3px; }
	.dict-html { font-size: 14px; }
`;

const THEME_STYLES: Record<HtmlExportTheme, string> = {
	warm: WARM_STYLE,
	steel: STEEL_STYLE,
	"navy-gold": NAVY_GOLD_STYLE,
	consult: CONSULT_STYLE,
};
