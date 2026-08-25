// 从 DOM Range 出发提取"单词所在的完整句子"。
// 阅读视图（Reading View）里块级元素就是真正的段落（<p>），直接用。
// 实时预览/源码模式（Live Preview / Source）里每行是独立的 .cm-line，
// 需要按"空行/标题/列表起始"为边界，向前后合并相邻行，还原成一个段落。

export interface ExtractedContext {
	sentence: string;
	paragraph: string;
}

const BLOCK_SELECTOR = "p, li, blockquote, td, th, h1, h2, h3, h4, h5, h6, .cm-line";
const BLOCK_START_PATTERN = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|```)/;

export function extractContext(range: Range): ExtractedContext | null {
	const container = range.startContainer;
	const startEl = container.nodeType === Node.TEXT_NODE ? container.parentElement : (container as Element);
	if (!startEl) return null;
	const block = startEl.closest(BLOCK_SELECTOR);
	if (!block) return null;

	let mergedText: string;
	let offsetInMerged: number;

	if (block.classList.contains("cm-line")) {
		const merged = mergeCmLines(block, range);
		mergedText = merged.text;
		offsetInMerged = merged.offset;
	} else {
		mergedText = normalize(block.textContent ?? "");
		offsetInMerged = offsetWithinElement(block, range);
	}

	if (!mergedText) return null;
	return { sentence: sentenceAt(mergedText, offsetInMerged), paragraph: mergedText };
}

function normalize(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function offsetWithinElement(el: Element, range: Range): number {
	const pre = range.cloneRange();
	pre.selectNodeContents(el);
	pre.setEnd(range.startContainer, range.startOffset);
	return normalize(pre.toString()).length;
}

function mergeCmLines(line: Element, range: Range): { text: string; offset: number } {
	const parent = line.parentElement;
	if (!parent) return { text: normalize(line.textContent ?? ""), offset: 0 };

	const lines = Array.from(parent.children).filter((c) => c.classList.contains("cm-line"));
	const idx = lines.indexOf(line);
	if (idx === -1) return { text: normalize(line.textContent ?? ""), offset: 0 };

	const isBoundary = (el: Element) => {
		const t = normalize(el.textContent ?? "");
		return t.length === 0 || BLOCK_START_PATTERN.test(t);
	};

	let start = idx;
	while (start > 0 && !isBoundary(lines[start - 1])) start--;
	let end = idx;
	while (end < lines.length - 1 && !isBoundary(lines[end + 1])) end++;

	let offset = 0;
	const parts: string[] = [];
	for (let i = start; i <= end; i++) {
		const t = normalize(lines[i].textContent ?? "");
		if (i === idx) {
			const prevLen = parts.reduce((sum, p) => sum + p.length + 1, 0);
			offset = prevLen + offsetWithinElement(lines[i], range);
		}
		parts.push(t);
	}
	return { text: parts.join(" "), offset };
}

function sentenceAt(text: string, offset: number): string {
	const sentences = text.match(/[^.!?。！？]+[.!?。！？]*/g) ?? [text];
	let acc = 0;
	for (const s of sentences) {
		acc += s.length;
		if (offset <= acc) return s.trim();
	}
	return sentences[sentences.length - 1]?.trim() ?? text;
}
