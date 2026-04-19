import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

interface ImageInfo {
	name: string;
	filePath: string;
	mtime: number;
}

export class GalleryViewProvider implements vscode.WebviewViewProvider {
	private _view?: vscode.WebviewView;
	private _getSaveDirectory: () => string;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		getSaveDirectory: () => string,
	) {
		this._getSaveDirectory = getSaveDirectory;
	}

	updateGetSaveDirectory(fn: () => string) {
		this._getSaveDirectory = fn;
	}

	refresh() {
		if (this._view) {
			this._view.webview.html = this._getHtmlForWebview(this._view.webview);
		}
	}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				this._extensionUri,
				vscode.Uri.file(this._getSaveDirectory()),
			],
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(async (message) => {
			switch (message.type) {
				case 'saveImage': {
					await this._saveImage(message.data, message.fileName);
					break;
				}
				case 'copyPath': {
					vscode.commands.executeCommand('screenshotManager.copyPath', message.filePath);
					break;
				}
				case 'revealInFinder': {
					vscode.commands.executeCommand('screenshotManager.revealInFinder', message.filePath);
					break;
				}
				case 'copyImage': {
					const { exec } = require('child_process');
					const escaped = message.filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
					const script = `osascript -l JavaScript -e 'ObjC.import("AppKit"); var pb = $.NSPasteboard.generalPasteboard; pb.clearContents; pb.setPropertyListForType($(["${escaped}"]), $.NSFilenamesPboardType);'`;
					exec(script, (err: Error | null) => {
						if (err) {
							vscode.window.showErrorMessage('Failed to copy file to clipboard');
						} else {
							vscode.window.showInformationMessage('File copied to clipboard');
						}
					});
					break;
				}
				case 'addToBoard': {
					vscode.commands.executeCommand('screenshotManager.addToBoard', message.filePath);
					break;
				}
				case 'deleteScreenshot': {
					vscode.commands.executeCommand('screenshotManager.deleteScreenshot', message.filePath);
					break;
				}
				case 'openPreview': {
					const panel = vscode.window.createWebviewPanel(
						'screenshotPreview',
						path.basename(message.filePath),
						vscode.ViewColumn.One,
						{ enableScripts: true, localResourceRoots: [vscode.Uri.file(this._getSaveDirectory())] },
					);
					const imageUri = panel.webview.asWebviewUri(vscode.Uri.file(message.filePath));
					panel.webview.html = this._getPreviewHtml(imageUri.toString(), path.basename(message.filePath));
					break;
				}
			}
		});
	}

	private async _saveImage(base64Data: string, fileName?: string) {
		const dir = this._getSaveDirectory();
		try {
			await fs.promises.mkdir(dir, { recursive: true });
		} catch {
			// directory already exists
		}

		const name = fileName || this._generateFileName();
		const filePath = path.join(dir, name);

		const buffer = Buffer.from(base64Data, 'base64');
		await fs.promises.writeFile(filePath, buffer);
	}

	private _generateFileName(): string {
		const now = new Date();
		const pad = (n: number) => String(n).padStart(2, '0');
		const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
		const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
		return `screenshot_${date}_${time}.png`;
	}

	private _getImages(): ImageInfo[] {
		const dir = this._getSaveDirectory();
		if (!fs.existsSync(dir)) {
			return [];
		}

		const files = fs.readdirSync(dir);
		const images: ImageInfo[] = [];

		for (const file of files) {
			const ext = path.extname(file).toLowerCase();
			if (!IMAGE_EXTENSIONS.has(ext)) {
				continue;
			}
			const filePath = path.join(dir, file);
			try {
				const stat = fs.statSync(filePath);
				if (stat.isFile()) {
					images.push({ name: file, filePath, mtime: stat.mtimeMs });
				}
			} catch {
				// skip files that can't be stat'd (e.g. iCloud placeholders)
			}
		}

		images.sort((a, b) => b.mtime - a.mtime);
		return images;
	}

	private _getHtmlForWebview(webview: vscode.Webview): string {
		const images = this._getImages();
		const nonce = getNonce();

		// Update localResourceRoots to include current save directory
		const dir = this._getSaveDirectory();

		const imageItems = images.map(img => {
			const src = webview.asWebviewUri(vscode.Uri.file(img.filePath));
			return `
				<div class="grid-item" data-path="${escapeHtml(img.filePath)}">
					<img src="${src}" alt="${escapeHtml(img.name)}" loading="lazy" />
					<div class="overlay">
						<span class="file-name">${escapeHtml(img.name)}</span>
						<div class="actions">
							<button class="action-btn" data-action="copyImage" title="Copy file">
								<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M6.002 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/><path d="M2.002 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2h-12zm12 1a1 1 0 0 1 1 1v6.5l-3.777-1.947a.5.5 0 0 0-.577.093l-3.71 3.71-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12V3a1 1 0 0 1 1-1h12z"/></svg>
							</button>
							<button class="action-btn" data-action="copyPath" title="Copy path">
								<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 4h3v1H4v7h7v-3h1v3.5a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5v-8a.5.5 0 0 1 .5-.5z"/><path d="M7 1.5a.5.5 0 0 1 .5-.5h8a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5v-8zM8 2v7h7V2H8z"/></svg>
							</button>
							<button class="action-btn" data-action="revealInFinder" title="Reveal in Finder">
								<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 1h6l1 1H14.5a.5.5 0 0 1 .5.5v11a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-12a.5.5 0 0 1 .5-.5zM2 5v8h12V5H2zm0-2h5.5l-1-1H2v1z"/></svg>
							</button>
							<button class="action-btn" data-action="addToBoard" title="Add to Board">
								<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M0 1.5A1.5 1.5 0 0 1 1.5 0h13A1.5 1.5 0 0 1 16 1.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 0 14.5v-13zM1.5 1a.5.5 0 0 0-.5.5v13a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5v-13a.5.5 0 0 0-.5-.5h-13z"/><path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/></svg>
							</button>
							<button class="action-btn action-delete" data-action="deleteScreenshot" title="Delete">
								<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4L4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>
							</button>
						</div>
					</div>
				</div>`;
		}).join('\n');

		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
	* { margin: 0; padding: 0; box-sizing: border-box; }
	body {
		padding: 8px;
		color: var(--vscode-foreground);
		font-family: var(--vscode-font-family);
		font-size: var(--vscode-font-size);
	}

	.drop-zone {
		border: 2px dashed var(--vscode-input-border, #555);
		border-radius: 6px;
		padding: 20px 12px;
		text-align: center;
		margin-bottom: 12px;
		cursor: pointer;
		transition: border-color 0.2s, background 0.2s;
		color: var(--vscode-descriptionForeground);
		font-size: 12px;
		line-height: 1.5;
	}
	.drop-zone:focus-within,
	.drop-zone.drag-over {
		border-color: var(--vscode-focusBorder);
		background: var(--vscode-list-hoverBackground);
	}
	.drop-zone kbd {
		background: var(--vscode-keybindingLabel-background, rgba(128,128,128,0.17));
		border: 1px solid var(--vscode-keybindingLabel-border, rgba(128,128,128,0.4));
		border-radius: 3px;
		padding: 1px 5px;
		font-family: var(--vscode-font-family);
		font-size: 11px;
	}

	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
	}

	.grid-item {
		position: relative;
		border-radius: 4px;
		overflow: hidden;
		cursor: pointer;
		aspect-ratio: 1;
		background: var(--vscode-editor-background);
		border: 1px solid var(--vscode-panel-border, transparent);
	}
	.grid-item img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.grid-item .overlay {
		position: absolute;
		inset: 0;
		background: rgba(0,0,0,0.65);
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		padding: 6px;
		opacity: 0;
		transition: opacity 0.15s;
	}
	.grid-item:hover .overlay {
		opacity: 1;
	}
	.file-name {
		font-size: 10px;
		color: #eee;
		margin-bottom: 4px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.actions {
		display: flex;
		gap: 4px;
	}
	.action-btn {
		background: rgba(255,255,255,0.15);
		border: none;
		border-radius: 3px;
		color: #eee;
		cursor: pointer;
		padding: 4px 6px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 0.15s;
	}
	.action-btn:hover {
		background: rgba(255,255,255,0.3);
	}
	.action-delete:hover {
		background: rgba(255,80,80,0.6);
	}

	.empty-state {
		text-align: center;
		padding: 24px 12px;
		color: var(--vscode-descriptionForeground);
		font-size: 12px;
	}
</style>
</head>
<body>
	<div class="drop-zone" id="dropZone" tabindex="0">
		<kbd>Cmd+V</kbd> paste or drag image here
	</div>

	${images.length > 0
		? `<div class="grid">${imageItems}</div>`
		: '<div class="empty-state">No screenshots yet</div>'}

<script nonce="${nonce}">
(function() {
	const vscode = acquireVsCodeApi();
	const dropZone = document.getElementById('dropZone');

	// ---- Paste handling ----
	document.addEventListener('paste', (e) => {
		const items = e.clipboardData?.items;
		if (!items) return;
		for (const item of items) {
			if (item.type.startsWith('image/')) {
				e.preventDefault();
				const blob = item.getAsFile();
				if (blob) readAndSend(blob);
				return;
			}
		}
	});

	// ---- Drag & Drop ----
	dropZone.addEventListener('dragover', (e) => {
		e.preventDefault();
		dropZone.classList.add('drag-over');
	});
	dropZone.addEventListener('dragleave', () => {
		dropZone.classList.remove('drag-over');
	});
	dropZone.addEventListener('drop', (e) => {
		e.preventDefault();
		dropZone.classList.remove('drag-over');
		const files = e.dataTransfer?.files;
		if (!files) return;
		for (const file of files) {
			if (file.type.startsWith('image/')) {
				readAndSend(file, file.name);
			}
		}
	});

	function readAndSend(blob, originalName) {
		const reader = new FileReader();
		reader.onload = () => {
			const base64 = reader.result.split(',')[1];
			const ext = blob.type.split('/')[1] || 'png';
			const fileName = originalName || undefined;
			vscode.postMessage({ type: 'saveImage', data: base64, fileName });
		};
		reader.readAsDataURL(blob);
	}

	// ---- Grid click handling ----
	document.addEventListener('click', (e) => {
		const btn = e.target.closest('.action-btn');
		if (btn) {
			e.stopPropagation();
			const action = btn.dataset.action;
			const filePath = btn.closest('.grid-item').dataset.path;
			vscode.postMessage({ type: action, filePath });
			return;
		}

		const gridItem = e.target.closest('.grid-item');
		if (gridItem) {
			const filePath = gridItem.dataset.path;
			vscode.postMessage({ type: 'openPreview', filePath });
		}
	});
})();
</script>
</body>
</html>`;
	}

	private _getPreviewHtml(imageUri: string, title: string): string {
		const nonce = getNonce();
		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
	* { margin: 0; padding: 0; box-sizing: border-box; }
	body {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		background: var(--vscode-editor-background);
		padding: 16px;
	}
	img {
		max-width: 100%;
		max-height: 95vh;
		object-fit: contain;
		border-radius: 4px;
		box-shadow: 0 2px 16px rgba(0,0,0,0.3);
	}
</style>
</head>
<body>
	<img src="${imageUri}" alt="${escapeHtml(title)}" />
</body>
</html>`;
	}
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

function escapeHtml(str: string): string {
	return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
