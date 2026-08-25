import { ExportFieldConfig, VocabRecord } from "./types";
import { escapeHtml } from "./exportShared";

export function buildVocabHtmlList(records: VocabRecord[], fields: ExportFieldConfig[]): string {
	const enabledKeys = new Set(fields.filter((f) => f.enabled).map((f) => f.key));

	// 不同词典的 CSS 常有同名的通用 class（.word / .table ...），直接拼在一起会互相覆盖。
	// 每条释义单独用 <template> 包住自己的 <style>+HTML，靠页面底部的小脚本各自套一层
	// Shadow DOM 再展开，做到跟弹窗查词一样的"每本词典互不干扰"。
	let dictBlockSeq = 0;

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
						.map((d) => {
							const tplId = `mv-tpl-${dictBlockSeq++}`;
							return `
								<div class="dict-block">
									${multiDict ? `<div class="dict-name">${escapeHtml(d.dictName)}</div>` : ""}
									<div class="dict-html" data-dict-host="${tplId}"></div>
									<template id="${tplId}"><style>${d.css}</style>${d.html}</template>
								</div>
							`;
						})
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
		<script>
			document.querySelectorAll("[data-dict-host]").forEach(function (host) {
				var tpl = document.getElementById(host.getAttribute("data-dict-host"));
				if (!tpl) return;
				var root = host.attachShadow({ mode: "open" });
				root.appendChild(tpl.content.cloneNode(true));
			});
		</script>
	`;

	return wrapHtmlDoc("生词本", body, LIST_STYLE);
}

function wrapHtmlDoc(title: string, bodyHtml: string, styleTag: string): string {
	return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
${styleTag.startsWith("<style") ? styleTag : `<style>${styleTag}</style>`}
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
