// 词形还原：只负责"生成候选词根"，对不对交给词典裁决。
// 宁可多给几个候选（查不到自然落空），也不做"聪明"的唯一判断。
// 参考自之前 Anki 查词插件项目里验证过的三类问题：屈折变化 / 英美拼写。
// （派生词如 relocation -> relocate 交给 js-mdict 的 suggest() 编辑距离兜底）

const IRREGULAR: Record<string, string> = {
	went: "go",
	gone: "go",
	was: "be",
	were: "be",
	been: "be",
	is: "be",
	are: "be",
	am: "be",
	had: "have",
	has: "have",
	did: "do",
	does: "do",
	better: "good",
	best: "good",
	worse: "bad",
	worst: "bad",
	children: "child",
	men: "man",
	women: "woman",
	feet: "foot",
	teeth: "tooth",
	mice: "mouse",
	geese: "goose",
};

function inflectionCandidates(word: string): string[] {
	const w = word.toLowerCase();
	const out = new Set<string>();

	if (IRREGULAR[w]) out.add(IRREGULAR[w]);

	// 名词复数 / 动词三单
	if (w.endsWith("ies") && w.length > 4) out.add(w.slice(0, -3) + "y");
	if (w.endsWith("es") && w.length > 3) out.add(w.slice(0, -2));
	if (w.endsWith("s") && w.length > 3) out.add(w.slice(0, -1));

	// 过去式 / 过去分词
	if (w.endsWith("ied") && w.length > 4) out.add(w.slice(0, -3) + "y");
	if (w.endsWith("ed") && w.length > 3) {
		out.add(w.slice(0, -2)); // liked -> like (先当作直接去掉)
		out.add(w.slice(0, -2) + "e"); // liked -> lik + e? 下面单独处理更常见的情况
		const stem = w.slice(0, -2);
		out.add(stem); // played -> play
		// 双写辅音字母，如 stopped -> stop
		if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
			out.add(stem.slice(0, -1));
		}
	}

	// 现在分词
	if (w.endsWith("ing") && w.length > 5) {
		const stem = w.slice(0, -3);
		out.add(stem); // playing -> play
		out.add(stem + "e"); // making -> mak + e = make
		if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
			out.add(stem.slice(0, -1)); // running -> run
		}
	}

	// 比较级 / 最高级
	if (w.endsWith("iest") && w.length > 5) out.add(w.slice(0, -4) + "y");
	if (w.endsWith("ier") && w.length > 4) out.add(w.slice(0, -3) + "y");
	if (w.endsWith("est") && w.length > 4) out.add(w.slice(0, -3));
	if (w.endsWith("er") && w.length > 3) out.add(w.slice(0, -2));

	out.delete(w);
	return [...out];
}

function spellingVariants(word: string): string[] {
	const w = word.toLowerCase();
	const out = new Set<string>();
	const swaps: [RegExp, string][] = [
		[/ize\b/, "ise"],
		[/ise\b/, "ize"],
		[/izes\b/, "ises"],
		[/ises\b/, "izes"],
		[/ized\b/, "ised"],
		[/ised\b/, "ized"],
		[/izing\b/, "ising"],
		[/ising\b/, "izing"],
		[/our\b/, "or"],
		[/or\b/, "our"],
		[/re\b/, "er"],
		[/er\b/, "re"],
		[/yze\b/, "yse"],
		[/yse\b/, "yze"],
		[/ogue\b/, "og"],
		[/og\b/, "ogue"],
	];
	for (const [pat, rep] of swaps) {
		if (pat.test(w)) out.add(w.replace(pat, rep));
	}
	out.delete(w);
	return [...out];
}

/**
 * 生成候选词根列表，按"最可能"到"最不可能"排序，去重。
 */
export function candidateHeadwords(word: string): string[] {
	const w = word.trim().toLowerCase();
	if (!w) return [];
	const seen = new Set<string>([w]);
	const result: string[] = [];

	const add = (list: string[]) => {
		for (const c of list) {
			if (!seen.has(c)) {
				seen.add(c);
				result.push(c);
			}
		}
	};

	add(inflectionCandidates(w));
	add(spellingVariants(w));
	// 屈折变化之后再叠一层英美拼写（如 civilised -> civilise -> civilize）
	for (const c of [...result]) add(spellingVariants(c));

	return result;
}
