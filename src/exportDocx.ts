import { BorderStyle, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { ExportFieldConfig, VocabRecord } from "./types";

export async function buildVocabDocx(records: VocabRecord[], fields: ExportFieldConfig[]): Promise<ArrayBuffer> {
	const enabled = new Set(fields.filter((f) => f.enabled).map((f) => f.key));

	const children: Paragraph[] = [
		new Paragraph({ text: "生词本", heading: HeadingLevel.HEADING_1 }),
		new Paragraph({
			children: [new TextRun({ text: `共 ${records.length} 个单词 · 导出于 ${new Date().toLocaleString()}`, color: "888888" })],
			spacing: { after: 300 },
		}),
	];

	records.forEach((r, i) => {
		const heading = (enabled.has("index") ? `${i + 1}. ` : "") + r.word;
		children.push(new Paragraph({ text: heading, heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 80 } }));

		if (enabled.has("sentence") && r.sentence) {
			children.push(
				new Paragraph({
					children: [new TextRun({ text: r.sentence, italics: true })],
					indent: { left: 200 },
					border: { left: { style: BorderStyle.SINGLE, size: 12, color: "C8B47A", space: 8 } },
					spacing: { after: 100 },
				})
			);
		}

		const metaParts: string[] = [];
		if (enabled.has("book") && r.bookTitle) {
			const authorPart = r.bookAuthor && enabled.has("author") ? `（${r.bookAuthor}）` : "";
			metaParts.push(`《${r.bookTitle}》${authorPart}`);
		}
		if (enabled.has("date")) metaParts.push(new Date(r.createdAt).toLocaleString());
		if (enabled.has("headword") && r.headword && r.headword !== r.word) metaParts.push(`词典词条：${r.headword}`);
		if (metaParts.length > 0) {
			children.push(
				new Paragraph({
					children: [new TextRun({ text: metaParts.join("  ·  "), color: "999999", size: 18 })],
					spacing: { after: 120 },
				})
			);
		}

		if (enabled.has("definition")) {
			const multiDict = r.definitions.length > 1;
			for (const d of r.definitions) {
				if (multiDict) {
					children.push(
						new Paragraph({
							children: [new TextRun({ text: d.dictName, bold: true, color: "A6813F", size: 18 })],
							spacing: { before: 60, after: 20 },
						})
					);
				}
				const lines = d.text.split(/\n+/).filter((l) => l.length > 0);
				for (const line of lines.length > 0 ? lines : [""]) {
					children.push(new Paragraph({ text: line, spacing: { after: 20 } }));
				}
			}
		}
	});

	const doc = new Document({ sections: [{ children }] });
	const buffer = await Packer.toBuffer(doc);
	return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}
