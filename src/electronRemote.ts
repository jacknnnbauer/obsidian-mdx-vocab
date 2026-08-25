// @electron/remote 由 Obsidian 自己的主进程注册好，插件这边直接 require 即可拿到原生对话框。
// 用动态 require（而不是顶层 import）是为了在极少数环境不支持时不至于让整个插件加载失败。
export function getElectronRemote(): any {
	try {
		return require("@electron/remote");
	} catch {
		return null;
	}
}
