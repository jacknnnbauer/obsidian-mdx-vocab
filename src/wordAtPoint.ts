// 单击查词模式用：把"鼠标点在页面上的一个坐标"还原成"这个坐标所在的那个单词"的 Range。

const WORD_CHAR = /[A-Za-z0-9'’À-ɏ-]/;

interface CaretPositionResult {
	offsetNode: Node;
	offset: number;
}

export function wordRangeAtPoint(x: number, y: number): Range | null {
	const doc = document as Document & {
		caretPositionFromPoint?: (x: number, y: number) => CaretPositionResult | null;
	};

	let node: Node | null = null;
	let offset = 0;

	if (typeof document.caretRangeFromPoint === "function") {
		const r = document.caretRangeFromPoint(x, y);
		if (!r) return null;
		node = r.startContainer;
		offset = r.startOffset;
	} else if (typeof doc.caretPositionFromPoint === "function") {
		const pos = doc.caretPositionFromPoint(x, y);
		if (!pos) return null;
		node = pos.offsetNode;
		offset = pos.offset;
	} else {
		return null;
	}

	if (!node || node.nodeType !== Node.TEXT_NODE) return null;
	const text = node.textContent ?? "";

	let start = offset;
	let end = offset;
	while (start > 0 && WORD_CHAR.test(text[start - 1])) start--;
	while (end < text.length && WORD_CHAR.test(text[end])) end++;
	if (start === end) return null;

	const range = document.createRange();
	range.setStart(node, start);
	range.setEnd(node, end);
	return range;
}
