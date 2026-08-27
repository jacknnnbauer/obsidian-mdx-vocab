import { App, FuzzySuggestModal, Modal, Notice, PluginSettingTab, Setting, TFolder } from "obsidian";
import type VocabPlugin from "./main";
import { DictionaryEntry } from "./types";
import { getElectronRemote } from "./electronRemote";

export class VocabSettingTab extends PluginSettingTab {
	private recordsCountSetting?: Setting;
	private recordsWrapEl?: HTMLElement;
	private selectedRecordIds = new Set<string>();

	constructor(app: App, private plugin: VocabPlugin) {
		super(app, plugin);
	}

	private addDictionaries(container: HTMLElement): void {
		const electronRemote = getElectronRemote();
		if (!electronRemote?.dialog) {
			new Notice("当前环境不支持原生文件选择框，暂时无法添加词典");
			return;
		}

		const picked: string[] | undefined = electronRemote.dialog.showOpenDialogSync(
			electronRemote.getCurrentWindow?.(),
			{
				title: "选择一本或多本 MDX 词典文件",
				properties: ["openFile", "multiSelections"],
				filters: [{ name: "MDX 词典", extensions: ["mdx"] }],
			}
		);
		if (!picked || picked.length === 0) return;

		for (const p of picked) {
			this.plugin.settings.dictionaries.push({
				id: makeId(),
				name: baseNameNoExt(p),
				path: p,
				enabled: true,
			});
		}
		void this.plugin.saveSettings();

		const results = this.plugin.reloadDictionaries();
		const ok = results.filter((r) => r.ok).length;
		const fail = results.filter((r) => !r.ok);
		new Notice(fail.length === 0 ? `已加载 ${ok} 本词典` : `已加载 ${ok} 本，${fail.length} 本失败：${fail.map((f) => f.name).join("、")}`);

		this.renderDictList(container);
	}

	private renderDictList(container: HTMLElement): void {
		container.empty();
		const dicts = this.plugin.settings.dictionaries;

		if (dicts.length === 0) {
			container.createEl("p", { text: "还没有添加词典。", cls: "setting-item-description" });
		}

		dicts.forEach((d: DictionaryEntry, idx: number) => {
			const row = new Setting(container).setName(d.name).setDesc(d.path);

			row.addToggle((t) =>
				t
					.setTooltip("启用/停用这本词典")
					.setValue(d.enabled)
					.onChange(async (v) => {
						d.enabled = v;
						await this.plugin.saveSettings();
						this.plugin.reloadDictionaries();
					})
			);
			row.addExtraButton((b) =>
				b
					.setIcon("pencil")
					.setTooltip("重命名")
					.onClick(() => {
						new TextPromptModal(this.app, "词典显示名称", d.name, async (name) => {
							if (name.trim()) {
								d.name = name.trim();
								await this.plugin.saveSettings();
								this.renderDictList(container);
							}
						}).open();
					})
			);
			row.addExtraButton((b) =>
				b
					.setIcon("trash")
					.setTooltip("移除")
					.onClick(async () => {
						dicts.splice(idx, 1);
						await this.plugin.saveSettings();
						this.plugin.reloadDictionaries();
						this.renderDictList(container);
					})
			);
			row.addExtraButton((b) =>
				b
					.setIcon("arrow-up")
					.setTooltip("上移")
					.setDisabled(idx === 0)
					.onClick(async () => {
						[dicts[idx - 1], dicts[idx]] = [dicts[idx], dicts[idx - 1]];
						await this.plugin.saveSettings();
						this.renderDictList(container);
					})
			);
			row.addExtraButton((b) =>
				b
					.setIcon("arrow-down")
					.setTooltip("下移")
					.setDisabled(idx === dicts.length - 1)
					.onClick(async () => {
						[dicts[idx + 1], dicts[idx]] = [dicts[idx], dicts[idx + 1]];
						await this.plugin.saveSettings();
						this.renderDictList(container);
					})
			);
		});

		new Setting(container).addButton((btn) =>
			btn
				.setButtonText("+ 添加词典…")
				.setCta()
				.onClick(() => this.addDictionaries(container))
		);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl).setName("MDX 点查生词本").setHeading();

		new Setting(containerEl).setName("词典（可添加多本，查词时会同时在所有已启用的词典里查）").setHeading();
		const dictList = containerEl.createDiv();
		this.renderDictList(dictList);
		containerEl.createEl("p", {
			text: "提示：词条引用的 .css 样式文件会自动加载并还原词典原生排版——不管这些资源是打包在同目录下同名的 .mdd 文件里，还是就以普通文件形式和 .mdx 放在一起，两种都支持。",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("查词触发方式")
			.setDesc(
				"双击词：不影响正常点击定位光标，最保险。单击词：最接近 Kindle 的单击查词体验，" +
					"但正文里点一下既会定位光标也会弹出查词。划词查词：拖动选中一段文字后松开鼠标自动查询（也兼容双击选词）。"
			)
			.addDropdown((dd) =>
				dd
					.addOption("dblclick", "双击查词")
					.addOption("click", "单击查词")
					.addOption("drag", "划词查词")
					.setValue(this.plugin.settings.lookupTrigger)
					.onChange(async (value) => {
						this.plugin.settings.lookupTrigger = value as "dblclick" | "click" | "drag";
						await this.plugin.saveSettings();
						this.plugin.rebindTriggers();
					})
			);

		new Setting(containerEl)
			.setName("书名字段（frontmatter）")
			.setDesc("笔记 frontmatter 里表示书名的字段名，留空或未填时用笔记文件名代替")
			.addText((text) =>
				text.setValue(this.plugin.settings.titleFrontmatterKey).onChange(async (value) => {
					this.plugin.settings.titleFrontmatterKey = value.trim();
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl).setName("作者字段（frontmatter）").addText((text) =>
			text.setValue(this.plugin.settings.authorFrontmatterKey).onChange(async (value) => {
				this.plugin.settings.authorFrontmatterKey = value.trim();
				await this.plugin.saveSettings();
			})
		);

		new Setting(containerEl).setName("同步到笔记").setHeading();
		new Setting(containerEl)
			.setName("查到的词记录到 Note 里")
			.setDesc("按书名（笔记标题）一本书一个 Note，追加写入单词、例句、书名/作者、时间，方便直接在 vault 里浏览（不含释义——释义通常很长，塞进 md 不好看，要看释义用插件设置页里的记录表格或导出）。")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.noteSync.enabled).onChange(async (v) => {
					this.plugin.settings.noteSync.enabled = v;
					await this.plugin.saveSettings();
				})
			);
		let noteFolderInput: any;
		new Setting(containerEl)
			.setName("Note 存放文件夹")
			.addText((text) => {
				noteFolderInput = text;
				text.setValue(this.plugin.settings.noteSync.folder).onChange(async (value) => {
					this.plugin.settings.noteSync.folder = value.trim() || "生词记录";
					await this.plugin.saveSettings();
				});
			})
			.addButton((btn) =>
				btn.setButtonText("浏览…").onClick(() => {
					new FolderSuggestModal(this.app, async (folder) => {
						this.plugin.settings.noteSync.folder = folder;
						noteFolderInput?.setValue(folder);
						await this.plugin.saveSettings();
					}).open();
				})
			);

		new Setting(containerEl).setName("导出").setHeading();
		new Setting(containerEl)
			.setName("导出格式")
			.addDropdown((dd) =>
				dd
					.addOption("docx", "Word（逐词排版，含完整释义）")
					.addOption("html-list", "HTML（逐词排版，含完整释义）")
					.setValue(this.plugin.settings.exportFormat)
					.onChange(async (value) => {
						this.plugin.settings.exportFormat = value as "docx" | "html-list";
						await this.plugin.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName("默认导出文件夹")
			.setDesc("点「导出」时会弹出保存对话框，默认定位到 vault 内的这个文件夹，你也可以现场改存到别的地方")
			.addText((text) =>
				text.setValue(this.plugin.settings.exportFolder).onChange(async (value) => {
					this.plugin.settings.exportFolder = value.trim() || "生词本导出";
					await this.plugin.saveSettings();
				})
			);
		containerEl.createEl("p", {
			text: "想要 PDF？导出 HTML 后用浏览器打开，「打印」→「另存为 PDF」即可，版式已经适配好打印效果，跟直接导出 PDF 是一样的。",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("模糊匹配的编辑距离")
			.setDesc("精确匹配和词形还原都查不到时，用于推测相近词条的编辑距离阈值；越大候选越多但越不准")
			.addSlider((slider) =>
				slider
					.setLimits(1, 4, 1)
					.setValue(this.plugin.settings.fuzzyEditDistance)
					.onChange(async (value) => {
						this.plugin.settings.fuzzyEditDistance = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName("导出字段（勾选是否导出，用上下箭头排序）").setHeading();
		const list = containerEl.createDiv();
		this.renderFieldList(list);

		new Setting(containerEl).setName("生词本").setHeading();
		this.recordsCountSetting = new Setting(containerEl)
			.setName(`当前已记录 ${this.plugin.records.length} 个单词`)
			.setDesc("下面表格里勾选几条就只导出勾选的；一条都没勾就导出全部。")
			.addButton((btn) =>
				btn
					.setButtonText("导出")
					.setCta()
					.onClick(() => this.plugin.exportVocab(this.selectedRecordIds.size > 0 ? [...this.selectedRecordIds] : undefined))
			)
			.addButton((btn) =>
				btn
					.setButtonText("清空生词本")
					.setDestructive()
					.onClick(async () => {
						if (confirm("确定要清空全部生词记录吗？此操作不可撤销。")) {
							await this.plugin.clearRecords();
							this.recordsCountSetting?.setName(`当前已记录 ${this.plugin.records.length} 个单词`);
							if (this.recordsWrapEl) this.renderRecordsTable(this.recordsWrapEl);
						}
					})
			);

		new Setting(containerEl)
			.setName("修复旧记录的释义排版")
			.setDesc("早期版本导出的纯文本释义换行很乱；这个按钮会用已经存好的词条 HTML 重新生成一遍，不用重新查词。")
			.addButton((btn) =>
				btn.setButtonText("修复").onClick(async () => {
					const n = await this.plugin.regenerateDefinitionText();
					new Notice(n > 0 ? `已修复 ${n} 条释义` : "没有需要修复的记录");
				})
			);

		this.recordsWrapEl = containerEl.createDiv();
		this.renderRecordsTable(this.recordsWrapEl);
	}

	private renderRecordsTable(container: HTMLElement): void {
		container.empty();
		const records = [...this.plugin.records].reverse();
		const shown = records.slice(0, 50);

		// 记录删了之后，选中集合里可能还挂着已经不存在的 id，清一下
		const stillExists = new Set(this.plugin.records.map((r) => r.id));
		for (const id of this.selectedRecordIds) {
			if (!stillExists.has(id)) this.selectedRecordIds.delete(id);
		}

		if (shown.length === 0) {
			container.createEl("p", { text: "还没有查词记录。", cls: "setting-item-description" });
			return;
		}

		Object.assign(container.style, { minWidth: "0" });

		const toolbar = container.createDiv();
		Object.assign(toolbar.style, { display: "flex", gap: "8px", marginBottom: "6px" });
		const toolbarBtn = (text: string, onClick: () => void) => {
			const btn = toolbar.createEl("button", { text });
			Object.assign(btn.style, { fontSize: "12px" });
			btn.addEventListener("click", onClick);
			return btn;
		};
		toolbarBtn("全选", () => {
			for (const r of shown) this.selectedRecordIds.add(r.id);
			this.renderRecordsTable(container);
		});
		toolbarBtn("选中今天", () => {
			const todayKey = new Date().toDateString();
			for (const r of this.plugin.records) {
				if (new Date(r.createdAt).toDateString() === todayKey) this.selectedRecordIds.add(r.id);
			}
			this.renderRecordsTable(container);
		});
		toolbarBtn("清空选择", () => {
			this.selectedRecordIds.clear();
			this.renderRecordsTable(container);
		});
		if (this.selectedRecordIds.size > 0) {
			const countLabel = toolbar.createSpan({
				text: `已选 ${this.selectedRecordIds.size} 条`,
				cls: "setting-item-description",
			});
			Object.assign(countLabel.style, { alignSelf: "center" });
		}

		// 横向滚动条的样式在 styles.css 里（.mv-records-scroll），Obsidian 会自动加载该文件，
		// 不需要在这里动态创建 <style> 元素。
		const wrap = container.createDiv({ cls: "mv-records-scroll" });
		Object.assign(wrap.style, {
			display: "block",
			width: "100%",
			minWidth: "0",
			maxWidth: "100%",
			boxSizing: "border-box",
			maxHeight: "320px",
			overflowY: "auto",
			overflowX: "auto",
			border: "1px solid var(--background-modifier-border)",
			borderRadius: "6px",
		});

		// 显式接管 wheel 事件：横向滚轮/触控板的 deltaX，以及没有横向滚轮时约定俗成的
		// Shift+滚轮，都换算成 scrollLeft——不依赖浏览器对 overflow-x 容器的默认处理。
		wrap.addEventListener(
			"wheel",
			(evt: WheelEvent) => {
				const horizontalDelta = evt.deltaX !== 0 ? evt.deltaX : evt.shiftKey ? evt.deltaY : 0;
				if (horizontalDelta === 0) return;
				if (wrap.scrollWidth <= wrap.clientWidth) return;
				wrap.scrollLeft += horizontalDelta;
				evt.preventDefault();
			},
			{ passive: false }
		);

		// 列宽写死（table-layout:fixed）+ 表格本身也写死总宽度：不给表格设自己的 width 的话，
		// fixed 布局仍然会把"多出来的空间"分给各列（大多分给内容最长的例句列），
		// 结果书名/时间/删除按钮被挤出可视区域。设了总宽度就不会再发生这种事。
		// 内容裁掉不留省略号，鼠标悬停能看到完整例句/书名（原生 title 提示）。
		const COLS: [string, number][] = [
			["", 24],
			["序号", 32],
			["单词", 70],
			["例句", 140],
			["书名", 92],
			["时间", 74],
			["", 30],
		];
		const table = wrap.createEl("table");
		Object.assign(table.style, {
			width: "100%",
			tableLayout: "fixed",
			borderCollapse: "collapse",
			fontSize: "12px",
		});

		const thead = table.createEl("thead");
		const headRow = thead.createEl("tr");
		COLS.forEach(([h, w], colIdx) => {
			const th = headRow.createEl("th", {});
			Object.assign(th.style, {
				width: `${w}px`,
				textAlign: "left",
				padding: "6px 8px",
				borderBottom: "1px solid var(--background-modifier-border)",
				position: "sticky",
				top: "0",
				background: "var(--background-primary)",
				whiteSpace: "nowrap",
			});
			if (colIdx === 0) {
				const headerCheckbox = th.createEl("input", { type: "checkbox" });
				headerCheckbox.checked = shown.every((r) => this.selectedRecordIds.has(r.id));
				headerCheckbox.addEventListener("change", () => {
					if (headerCheckbox.checked) shown.forEach((r) => this.selectedRecordIds.add(r.id));
					else shown.forEach((r) => this.selectedRecordIds.delete(r.id));
					this.renderRecordsTable(container);
				});
			} else {
				th.setText(h);
			}
		});

		const tbody = table.createEl("tbody");
		shown.forEach((r, idx) => {
			const row = tbody.createEl("tr");

			const checkTd = row.createEl("td");
			Object.assign(checkTd.style, { padding: "6px 8px", borderBottom: "1px solid var(--background-modifier-border)" });
			const checkbox = checkTd.createEl("input", { type: "checkbox" });
			checkbox.checked = this.selectedRecordIds.has(r.id);
			checkbox.addEventListener("change", () => {
				if (checkbox.checked) this.selectedRecordIds.add(r.id);
				else this.selectedRecordIds.delete(r.id);
			});

			const cell = (text: string, fullText?: string) => {
				const td = row.createEl("td", { text });
				Object.assign(td.style, {
					padding: "6px 8px",
					borderBottom: "1px solid var(--background-modifier-border)",
					verticalAlign: "top",
					overflow: "hidden",
					whiteSpace: "nowrap",
				});
				if (fullText) td.setAttr("title", fullText);
				return td;
			};
			cell(String(idx + 1));

			// 单词格子双击原地编辑：改完失焦/回车就用新词重新查一遍替换释义，不用额外按钮。
			const wordTd = row.createEl("td", { text: r.word });
			Object.assign(wordTd.style, {
				padding: "6px 8px",
				borderBottom: "1px solid var(--background-modifier-border)",
				verticalAlign: "top",
				overflow: "hidden",
				whiteSpace: "nowrap",
				cursor: "text",
			});
			wordTd.setAttr("title", "双击修改并重新查词（比如查到 opposed，其实想学 oppose）");
			wordTd.addEventListener("dblclick", () => {
				wordTd.empty();
				const input = wordTd.createEl("input", { type: "text" });
				Object.assign(input.style, {
					width: "100%",
					fontSize: "12px",
					padding: "0 2px",
					boxSizing: "border-box",
					border: "1px solid var(--interactive-accent)",
					background: "var(--background-primary)",
					color: "var(--text-normal)",
				});
				input.value = r.word;

				let settled = false;
				const commit = async () => {
					if (settled) return;
					settled = true;
					const newWord = input.value.trim();
					if (!newWord || newWord === r.word) {
						this.renderRecordsTable(container);
						return;
					}
					const result = await this.plugin.relookupRecord(r.id, newWord);
					new Notice(result.message);
					this.renderRecordsTable(container);
				};
				const cancel = () => {
					if (settled) return;
					settled = true;
					this.renderRecordsTable(container);
				};

				input.addEventListener("blur", commit);
				input.addEventListener("keydown", (evt) => {
					if (evt.key === "Enter") {
						evt.preventDefault();
						input.blur();
					} else if (evt.key === "Escape") {
						evt.preventDefault();
						cancel();
					}
				});

				input.focus();
				input.select();
			});

			cell(r.sentence, r.sentence);
			cell(r.bookTitle, r.bookTitle);
			cell(new Date(r.createdAt).toLocaleDateString());

			const actionTd = row.createEl("td");
			Object.assign(actionTd.style, {
				padding: "4px 6px",
				borderBottom: "1px solid var(--background-modifier-border)",
			});

			const delBtn = actionTd.createEl("button", { text: "×" });
			delBtn.setAttr("title", "删除这条记录");
			delBtn.addEventListener("click", async () => {
				await this.plugin.deleteRecord(r.id);
				this.recordsCountSetting?.setName(`当前已记录 ${this.plugin.records.length} 个单词`);
				this.renderRecordsTable(container);
			});
		});

		container.createEl("p", {
			text:
				records.length > shown.length
					? `共 ${records.length} 条，仅显示最近 ${shown.length} 条`
					: `共 ${records.length} 条`,
			cls: "setting-item-description",
		});
	}

	private renderFieldList(container: HTMLElement) {
		container.empty();
		const fields = this.plugin.settings.exportFields;
		fields.forEach((field, idx) => {
			const row = new Setting(container).setName(field.label);
			row.addToggle((t) =>
				t.setValue(field.enabled).onChange(async (v) => {
					field.enabled = v;
					await this.plugin.saveSettings();
				})
			);
			row.addExtraButton((b) =>
				b
					.setIcon("arrow-up")
					.setDisabled(idx === 0)
					.onClick(async () => {
						[fields[idx - 1], fields[idx]] = [fields[idx], fields[idx - 1]];
						await this.plugin.saveSettings();
						this.renderFieldList(container);
					})
			);
			row.addExtraButton((b) =>
				b
					.setIcon("arrow-down")
					.setDisabled(idx === fields.length - 1)
					.onClick(async () => {
						[fields[idx + 1], fields[idx]] = [fields[idx], fields[idx + 1]];
						await this.plugin.saveSettings();
						this.renderFieldList(container);
					})
			);
		});
	}
}

// Electron 的 window.prompt() 在很多版本里根本没实现（静默返回 null，什么弹窗都不出），
// 跟原生支持的 alert()/confirm() 不一样，所以但凡要收文本输入都用这个 Modal，不用 prompt()。
class TextPromptModal extends Modal {
	constructor(
		app: App,
		private title: string,
		private initialValue: string,
		private onSubmit: (value: string) => void
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: this.title });
		const input = contentEl.createEl("input", { type: "text" });
		Object.assign(input.style, { width: "100%" });
		input.value = this.initialValue;

		const submit = () => {
			this.close();
			this.onSubmit(input.value);
		};
		input.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter") submit();
			if (evt.key === "Escape") this.close();
		});

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("确定").setCta().onClick(submit))
			.addButton((b) => b.setButtonText("取消").onClick(() => this.close()));

		window.setTimeout(() => {
			input.focus();
			input.select();
		}, 0);
	}

	onClose() {
		this.contentEl.empty();
	}
}

class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
	constructor(app: App, private onPick: (folderPath: string) => void) {
		super(app);
		this.setPlaceholder("选择一个 vault 内的文件夹…");
	}

	getItems(): TFolder[] {
		const folders: TFolder[] = [this.app.vault.getRoot()];
		for (const f of this.app.vault.getAllLoadedFiles()) {
			if (f instanceof TFolder) folders.push(f);
		}
		return folders;
	}

	getItemText(folder: TFolder): string {
		return folder.path === "" ? "/ (vault 根目录)" : folder.path;
	}

	onChooseItem(folder: TFolder): void {
		this.onPick(folder.path === "" ? "/" : folder.path);
	}
}

function baseNameNoExt(p: string): string {
	const base = p.replace(/^.*[\\/]/, "");
	return base.replace(/\.mdx$/i, "");
}

function makeId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
