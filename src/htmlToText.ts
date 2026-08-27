// 把词典词条的 HTML+CSS 转成"像浏览器渲染出来那样"的纯文本，给 Word 导出用。
// 不挂真实 DOM/不动态创建 <style> 元素（Obsidian 插件规范不允许）：改成自己扫一遍 CSS，
// 找出哪些 class 被设成了 display:none（比如 COCA 词典默认收起的频率表格），
// 在纯文本里先把这些元素整个删掉，再按块级元素边界手动插入换行，模拟浏览器的折行效果。
export function htmlToPlainText(html: string, css: string): string {
	const hiddenClasses = extractDisplayNoneClasses(css);
	const doc = new DOMParser().parseFromString(html, "text/html");

	for (const cls of hiddenClasses) {
		doc.querySelectorAll(`.${CSS.escape(cls)}`).forEach((el) => el.remove());
	}

	doc.querySelectorAll("br").forEach((el) => el.replaceWith(doc.createTextNode("\n")));
	doc.querySelectorAll("div, p, tr, li, h1, h2, h3, h4, h5, h6").forEach((el) => {
		el.insertAdjacentText("afterend", "\n");
	});

	const text = doc.body.textContent ?? "";
	return text
		.replace(/[ \t]+/g, " ")
		.replace(/[ \t]*\n[ \t]*/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** 找出 CSS 里"单一 class 选择器 + display:none"的规则，只处理这种简单形式，避免误删。 */
function extractDisplayNoneClasses(css: string): string[] {
	const classes = new Set<string>();
	const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
	let match: RegExpExecArray | null;
	while ((match = ruleRe.exec(css))) {
		const [, selectorList, body] = match;
		if (!/display\s*:\s*none/i.test(body)) continue;
		for (const selector of selectorList.split(",")) {
			const classMatch = selector.trim().match(/^\.([\w-]+)$/);
			if (classMatch) classes.add(classMatch[1]);
		}
	}
	return [...classes];
}
