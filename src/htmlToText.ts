// 把词典词条的 HTML+CSS 转成"像浏览器渲染出来那样"的纯文本，给 Word 导出用。
// 关键是用 innerText 而不是 textContent：textContent 会把词典源码里大量纯排版用的换行/缩进
// 原样保留（变成"一个词一行"的乱码），innerText 则按实际渲染结果折行，并且会跳过
// display:none 的内容（比如 COCA 词典默认收起的频率表格），跟 MDict / 弹窗里看到的一致。
export function htmlToPlainText(html: string, css: string): string {
	const host = document.createElement("div");
	Object.assign(host.style, {
		position: "fixed",
		top: "-9999px",
		left: "-9999px",
		width: "600px",
		pointerEvents: "none",
	});
	document.body.appendChild(host);

	try {
		const shadow = host.attachShadow({ mode: "open" });
		const style = document.createElement("style");
		style.textContent = css;
		shadow.appendChild(style);
		const inner = document.createElement("div");
		inner.innerHTML = html;
		shadow.appendChild(inner);

		const text = inner.innerText || inner.textContent || "";
		return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
	} finally {
		host.remove();
	}
}
