import { MDX, MDD } from "js-mdict";
import * as path from "path";
import * as fs from "fs";
import { candidateHeadwords } from "./lemmatizer";
import { htmlToPlainText } from "./htmlToText";

export interface LookupResult {
	headword: string;
	html: string; // 已去除 <script>/<link>/<img>，<a> 降级为 <span> 的词条 HTML 片段
	css: string; // 词典自带样式（可能为空）
	plainText: string; // 纯文本释义，用于导出 Word
	matchType: "exact" | "inflection" | "fuzzy";
}

export interface LookupFailure {
	word: string;
	suggestions: string[]; // 供用户手动挑选的候选词条
}

interface DictHandle {
	mdx: MDX;
	mdd: MDD | null;
	dir: string;
	cssCache: Map<string, string>;
}

/** 管理"多本已加载的词典"，每本用调用方给的 id 区分（对应 settings 里的 DictionaryEntry.id） */
export class DictionaryManager {
	private handles = new Map<string, DictHandle>();

	get loadedIds(): string[] {
		return [...this.handles.keys()];
	}

	isLoaded(id: string): boolean {
		return this.handles.has(id);
	}

	load(id: string, mdxPath: string): { ok: true; entryCount: number } | { ok: false; error: string } {
		try {
			const mdx = new MDX(mdxPath);
			const dir = path.dirname(mdxPath);
			let mdd: MDD | null = null;
			const mddPath = mdxPath.replace(/\.mdx$/i, "") + ".mdd";
			if (fs.existsSync(mddPath)) {
				try {
					mdd = new MDD(mddPath);
				} catch {
					mdd = null;
				}
			}
			this.handles.set(id, { mdx, mdd, dir, cssCache: new Map() });
			const entryCount = mdx.keywordList?.length ?? 0;
			return { ok: true, entryCount };
		} catch (e) {
			this.handles.delete(id);
			return { ok: false, error: e instanceof Error ? e.message : String(e) };
		}
	}

	unload(id: string) {
		this.handles.delete(id);
	}

	unloadAll() {
		this.handles.clear();
	}

	lookupIn(id: string, word: string, fuzzyEditDistance: number): LookupResult | LookupFailure {
		const handle = this.handles.get(id);
		if (!handle) return { word, suggestions: [] };

		const exact = this.tryFetch(handle, word);
		if (exact) return this.buildResult(handle, exact.keyText, exact.definition ?? "", "exact");

		for (const candidate of candidateHeadwords(word)) {
			const hit = this.tryFetch(handle, candidate);
			if (hit) return this.buildResult(handle, hit.keyText, hit.definition ?? "", "inflection");
		}

		const fuzzy = handle.mdx.suggest(word, fuzzyEditDistance);
		if (fuzzy.length > 0) {
			const top = this.tryFetch(handle, fuzzy[0].keyText);
			if (top) return this.buildResult(handle, top.keyText, top.definition ?? "", "fuzzy");
		}

		const suggestions = fuzzy.slice(0, 8).map((f) => f.keyText);
		return { word, suggestions };
	}

	/** 用户从候选列表里手动选中某个词条，或手动输入词条时调用 */
	lookupExactIn(id: string, headword: string): LookupResult | null {
		const handle = this.handles.get(id);
		if (!handle) return null;
		const hit = this.tryFetch(handle, headword);
		if (!hit) return null;
		return this.buildResult(handle, hit.keyText, hit.definition ?? "", "exact");
	}

	private tryFetch(handle: DictHandle, word: string): { keyText: string; definition: string | null } | null {
		try {
			const r = handle.mdx.lookup(word);
			if (r && r.definition) return r;
			return null;
		} catch {
			return null;
		}
	}

	private buildResult(
		handle: DictHandle,
		headword: string,
		rawHtml: string,
		matchType: LookupResult["matchType"]
	): LookupResult {
		const linkHrefs = [...rawHtml.matchAll(/<link[^>]+href=["']([^"']+)["'][^>]*>/gi)].map((m) => m[1]);

		let cleaned = rawHtml
			.replace(/<script[\s\S]*?<\/script>/gi, "")
			.replace(/<link[^>]*>/gi, "")
			.replace(/<\/?head>/gi, "")
			.replace(/<\/?body[^>]*>/gi, "");

		// 不需要图片（本地没接资源加载，加载失败也只会留一个破图标），发音/跳转链接也不需要能点：
		// 图片整个删掉；<a> 降级成 <span>（保留文字和 class，方便词典自带 CSS 继续生效），去掉 href 避免点击跳转。
		cleaned = cleaned.replace(/<img\b[^>]*>/gi, "");
		cleaned = cleaned
			.replace(/<a\b([^>]*)>/gi, (_m, attrs: string) => {
				const kept = attrs
					.replace(/\s+href\s*=\s*("[^"]*"|'[^']*')/gi, "")
					.replace(/\s+target\s*=\s*("[^"]*"|'[^']*')/gi, "");
				return `<span${kept}>`;
			})
			.replace(/<\/a>/gi, "</span>");

		const css = linkHrefs
			.map((href) => this.loadCss(handle, href))
			.filter((c): c is string => !!c)
			.join("\n");

		const plainText = htmlToPlainText(cleaned, css);

		return { headword, html: cleaned, css, plainText, matchType };
	}

	private loadCss(handle: DictHandle, href: string): string | null {
		if (handle.cssCache.has(href)) return handle.cssCache.get(href) ?? null;

		let content: string | null = null;

		if (handle.mdd) {
			try {
				const res = handle.mdd.locate(href) || handle.mdd.locate("\\" + href.replace(/\//g, "\\"));
				if (res && res.definition) {
					content = Buffer.from(res.definition, "base64").toString("utf-8");
				}
			} catch {
				content = null;
			}
		}

		if (!content) {
			const sibling = path.join(handle.dir, href);
			if (fs.existsSync(sibling)) {
				try {
					content = fs.readFileSync(sibling, "utf-8");
				} catch {
					content = null;
				}
			}
		}

		handle.cssCache.set(href, content ?? "");
		return content;
	}
}
