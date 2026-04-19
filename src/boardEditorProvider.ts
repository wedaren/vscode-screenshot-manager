import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface BoardItem {
	id: string;
	filePath: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface BoardState {
	canvasX: number;
	canvasY: number;
	canvasScale: number;
	items: BoardItem[];
}

export class BoardEditorProvider {
	private _panel?: vscode.WebviewPanel;
	private _boardFilePath: string;
	private _state: BoardState;
	private _getSaveDirectory: () => string;
	private _extensionUri: vscode.Uri;

	constructor(extensionUri: vscode.Uri, getSaveDirectory: () => string) {
		this._extensionUri = extensionUri;
		this._getSaveDirectory = getSaveDirectory;
		this._boardFilePath = '';
		this._state = { canvasX: 0, canvasY: 0, canvasScale: 1, items: [] };
	}

	open() {
		if (this._panel) {
			this._panel.reveal();
			return;
		}

		this._boardFilePath = path.join(this._getSaveDirectory(), '.board.json');
		this._loadState();

		this._panel = vscode.window.createWebviewPanel(
			'screenshotBoard',
			'Investigation Board',
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [
					this._extensionUri,
					vscode.Uri.file(this._getSaveDirectory()),
				],
			},
		);

		this._panel.webview.html = this._getHtml(this._panel.webview);

		this._panel.webview.onDidReceiveMessage(async (msg) => {
			switch (msg.type) {
				case 'updateState': {
					this._state.canvasX = msg.canvasX;
					this._state.canvasY = msg.canvasY;
					this._state.canvasScale = msg.canvasScale;
					this._state.items = msg.items;
					this._saveState();
					break;
				}
				case 'saveImage': {
					const filePath = await this._saveImageFile(msg.data, msg.fileName);
					if (filePath) {
						const uri = this._panel!.webview.asWebviewUri(vscode.Uri.file(filePath));
						this._panel!.webview.postMessage({
							type: 'imageAdded',
							filePath,
							webviewUri: uri.toString(),
							x: msg.x,
							y: msg.y,
						});
					}
					break;
				}
				case 'resolveUri': {
					const uri = this._panel!.webview.asWebviewUri(vscode.Uri.file(msg.filePath));
					this._panel!.webview.postMessage({
						type: 'uriResolved',
						id: msg.id,
						webviewUri: uri.toString(),
					});
					break;
				}
				case 'requestDrop': {
					// File dropped from external — data is base64
					const filePath = await this._saveImageFile(msg.data, msg.fileName);
					if (filePath) {
						const uri = this._panel!.webview.asWebviewUri(vscode.Uri.file(filePath));
						this._panel!.webview.postMessage({
							type: 'imageAdded',
							filePath,
							webviewUri: uri.toString(),
							x: msg.x,
							y: msg.y,
						});
					}
					break;
				}
				case 'pickFiles': {
					const files = await vscode.window.showOpenDialog({
						canSelectMany: true,
						filters: { 'Images': ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
						defaultUri: vscode.Uri.file(this._getSaveDirectory()),
					});
					if (files && files.length > 0) {
						const rect = { cx: msg.cx, cy: msg.cy };
						let offsetX = 0;
						for (const file of files) {
							const uri = this._panel!.webview.asWebviewUri(file);
							this._panel!.webview.postMessage({
								type: 'imageAdded',
								filePath: file.fsPath,
								webviewUri: uri.toString(),
								x: rect.cx + offsetX,
								y: rect.cy,
							});
							offsetX += 320;
						}
					}
					break;
				}
			}
		});

		this._panel.onDidDispose(() => {
			this._panel = undefined;
		});
	}

	addImageToBoard(filePath: string) {
		if (!this._panel) {
			this.open();
		}
		// Wait a tick for panel to initialize
		setTimeout(() => {
			if (this._panel) {
				const uri = this._panel.webview.asWebviewUri(vscode.Uri.file(filePath));
				this._panel.webview.postMessage({
					type: 'imageAdded',
					filePath,
					webviewUri: uri.toString(),
					x: (-this._state.canvasX + 400) / this._state.canvasScale,
					y: (-this._state.canvasY + 300) / this._state.canvasScale,
				});
			}
		}, 500);
	}

	private _loadState() {
		try {
			if (fs.existsSync(this._boardFilePath)) {
				const raw = fs.readFileSync(this._boardFilePath, 'utf-8');
				this._state = JSON.parse(raw);
			}
		} catch {
			this._state = { canvasX: 0, canvasY: 0, canvasScale: 1, items: [] };
		}
	}

	private _saveState() {
		const dir = this._getSaveDirectory();
		try {
			fs.mkdirSync(dir, { recursive: true });
		} catch { /* */ }
		fs.writeFileSync(this._boardFilePath, JSON.stringify(this._state, null, 2));
	}

	private async _saveImageFile(base64Data: string, fileName?: string): Promise<string | undefined> {
		const dir = this._getSaveDirectory();
		try {
			await fs.promises.mkdir(dir, { recursive: true });
		} catch { /* */ }
		const name = fileName || this._generateFileName();
		const filePath = path.join(dir, name);
		const buffer = Buffer.from(base64Data, 'base64');
		await fs.promises.writeFile(filePath, buffer);
		return filePath;
	}

	private _generateFileName(): string {
		const now = new Date();
		const pad = (n: number) => String(n).padStart(2, '0');
		const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
		const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
		const ms = String(now.getMilliseconds()).padStart(3, '0');
		return `screenshot_${date}_${time}_${ms}.png`;
	}

	private _getHtml(webview: vscode.Webview): string {
		const nonce = getNonce();

		// Resolve existing items to webview URIs
		const itemsWithUri = this._state.items.map(item => ({
			...item,
			webviewUri: webview.asWebviewUri(vscode.Uri.file(item.filePath)).toString(),
		}));

		const stateJson = JSON.stringify({
			canvasX: this._state.canvasX,
			canvasY: this._state.canvasY,
			canvasScale: this._state.canvasScale,
			items: itemsWithUri,
		}).replace(/</g, '\\u003c');

		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
	* { margin: 0; padding: 0; box-sizing: border-box; }
	html, body {
		width: 100%; height: 100%;
		overflow: hidden;
		background: var(--vscode-editor-background);
		font-family: var(--vscode-font-family);
	}

	#viewport {
		width: 100%; height: 100%;
		overflow: hidden;
		position: relative;
		cursor: grab;
	}
	#viewport.grabbing { cursor: grabbing; }

	#canvas {
		position: absolute;
		top: 0; left: 0;
		transform-origin: 0 0;
		/* grid background rendered via JS */
	}

	.board-item {
		position: absolute;
		cursor: move;
		user-select: none;
		border: 2px solid transparent;
		border-radius: 4px;
		box-shadow: 0 2px 12px rgba(0,0,0,0.3);
		transition: border-color 0.1s;
	}
	.board-item:hover {
		border-color: var(--vscode-focusBorder);
	}
	.board-item.selected {
		border-color: var(--vscode-focusBorder);
	}
	.board-item img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
		pointer-events: none;
		border-radius: 2px;
		background: var(--vscode-editor-background);
	}

	.resize-handle {
		position: absolute;
		width: 14px; height: 14px;
		right: -4px; bottom: -4px;
		cursor: nwse-resize;
		background: var(--vscode-focusBorder);
		border-radius: 2px;
		opacity: 0;
		transition: opacity 0.15s;
	}
	.board-item:hover .resize-handle,
	.board-item.selected .resize-handle {
		opacity: 1;
	}

	.delete-handle {
		position: absolute;
		width: 20px; height: 20px;
		right: -6px; top: -6px;
		cursor: pointer;
		background: rgba(255,80,80,0.85);
		border-radius: 50%;
		opacity: 0;
		transition: opacity 0.15s;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #fff;
		font-size: 12px;
		line-height: 1;
		font-weight: bold;
	}
	.board-item:hover .delete-handle,
	.board-item.selected .delete-handle {
		opacity: 1;
	}

	#hint {
		position: fixed;
		bottom: 12px;
		left: 50%;
		transform: translateX(-50%);
		background: var(--vscode-editorWidget-background, rgba(30,30,30,0.9));
		color: var(--vscode-editorWidget-foreground, #ccc);
		padding: 6px 16px;
		border-radius: 6px;
		font-size: 11px;
		pointer-events: none;
		opacity: 0.7;
		white-space: nowrap;
	}

	#toolbar {
		position: fixed;
		top: 10px;
		right: 10px;
		display: flex;
		gap: 6px;
		z-index: 100;
	}
	.toolbar-btn {
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
		border: none;
		border-radius: 4px;
		padding: 6px 12px;
		font-size: 12px;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 4px;
		font-family: var(--vscode-font-family);
		transition: background 0.15s;
	}
	.toolbar-btn:hover {
		background: var(--vscode-button-hoverBackground);
	}
	.toolbar-btn svg {
		flex-shrink: 0;
	}
</style>
</head>
<body>
<div id="toolbar">
	<button class="toolbar-btn" id="btnAddFiles">
		<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/><path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H4z"/></svg>
		Add Images
	</button>
</div>
<div id="viewport">
	<div id="canvas"></div>
</div>
<div id="hint">Scroll to zoom · Drag background to pan · Drag images to move · Cmd+V to paste</div>

<script nonce="${nonce}">
(function() {
	const vscodeApi = acquireVsCodeApi();
	const viewport = document.getElementById('viewport');
	const canvas = document.getElementById('canvas');

	let state = ${stateJson};
	let items = state.items; // each: { id, filePath, webviewUri, x, y, width, height }
	let camX = state.canvasX;
	let camY = state.canvasY;
	let scale = state.canvasScale;

	let idCounter = Date.now();
	function newId() { return 'item_' + (idCounter++); }

	// ---- Render canvas transform ----
	function applyTransform() {
		canvas.style.transform = 'translate(' + camX + 'px, ' + camY + 'px) scale(' + scale + ')';
	}
	applyTransform();

	// ---- Render existing items ----
	items.forEach(item => createItemElement(item));

	// ---- Canvas pan ----
	let isPanning = false;
	let panStartX, panStartY, panStartCamX, panStartCamY;

	viewport.addEventListener('pointerdown', (e) => {
		if (e.target !== viewport && e.target !== canvas) return;
		isPanning = true;
		panStartX = e.clientX;
		panStartY = e.clientY;
		panStartCamX = camX;
		panStartCamY = camY;
		viewport.classList.add('grabbing');
		viewport.setPointerCapture(e.pointerId);
	});
	viewport.addEventListener('pointermove', (e) => {
		if (!isPanning) return;
		camX = panStartCamX + (e.clientX - panStartX);
		camY = panStartCamY + (e.clientY - panStartY);
		applyTransform();
	});
	viewport.addEventListener('pointerup', (e) => {
		if (!isPanning) return;
		isPanning = false;
		viewport.classList.remove('grabbing');
		saveState();
	});

	// ---- Zoom ----
	viewport.addEventListener('wheel', (e) => {
		e.preventDefault();
		const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
		const rect = viewport.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;

		// Zoom toward mouse
		const newScale = Math.min(5, Math.max(0.1, scale * zoomFactor));
		const ratio = newScale / scale;
		camX = mx - ratio * (mx - camX);
		camY = my - ratio * (my - camY);
		scale = newScale;
		applyTransform();
		saveState();
	}, { passive: false });

	// ---- Create board item element ----
	function createItemElement(item) {
		const el = document.createElement('div');
		el.className = 'board-item';
		el.dataset.id = item.id;
		el.style.left = item.x + 'px';
		el.style.top = item.y + 'px';
		el.style.width = item.width + 'px';
		el.style.height = item.height + 'px';

		const img = document.createElement('img');
		img.src = item.webviewUri;
		img.draggable = false;
		el.appendChild(img);

		// Resize handle
		const resizeHandle = document.createElement('div');
		resizeHandle.className = 'resize-handle';
		el.appendChild(resizeHandle);

		// Delete handle
		const delHandle = document.createElement('div');
		delHandle.className = 'delete-handle';
		delHandle.textContent = '×';
		el.appendChild(delHandle);

		// ---- Drag to move ----
		let isDragging = false;
		let dragStartX, dragStartY, dragItemStartX, dragItemStartY;

		el.addEventListener('pointerdown', (e) => {
			if (e.target === resizeHandle || e.target === delHandle) return;
			e.stopPropagation();
			isDragging = true;
			dragStartX = e.clientX;
			dragStartY = e.clientY;
			dragItemStartX = item.x;
			dragItemStartY = item.y;
			el.classList.add('selected');
			el.setPointerCapture(e.pointerId);
		});
		el.addEventListener('pointermove', (e) => {
			if (!isDragging) return;
			const dx = (e.clientX - dragStartX) / scale;
			const dy = (e.clientY - dragStartY) / scale;
			item.x = dragItemStartX + dx;
			item.y = dragItemStartY + dy;
			el.style.left = item.x + 'px';
			el.style.top = item.y + 'px';
		});
		el.addEventListener('pointerup', (e) => {
			if (!isDragging) return;
			isDragging = false;
			el.classList.remove('selected');
			saveState();
		});

		// ---- Resize ----
		let isResizing = false;
		let resizeStartX, resizeStartY, resizeStartW, resizeStartH;

		resizeHandle.addEventListener('pointerdown', (e) => {
			e.stopPropagation();
			isResizing = true;
			resizeStartX = e.clientX;
			resizeStartY = e.clientY;
			resizeStartW = item.width;
			resizeStartH = item.height;
			resizeHandle.setPointerCapture(e.pointerId);
		});
		resizeHandle.addEventListener('pointermove', (e) => {
			if (!isResizing) return;
			const dx = (e.clientX - resizeStartX) / scale;
			const dy = (e.clientY - resizeStartY) / scale;
			const aspect = resizeStartW / resizeStartH;
			// Keep aspect ratio — use the larger delta
			let newW = Math.max(60, resizeStartW + dx);
			let newH = newW / aspect;
			item.width = newW;
			item.height = newH;
			el.style.width = newW + 'px';
			el.style.height = newH + 'px';
		});
		resizeHandle.addEventListener('pointerup', (e) => {
			if (!isResizing) return;
			isResizing = false;
			saveState();
		});

		// ---- Delete ----
		delHandle.addEventListener('click', (e) => {
			e.stopPropagation();
			el.remove();
			items = items.filter(i => i.id !== item.id);
			saveState();
		});

		canvas.appendChild(el);
		return el;
	}

	// ---- Paste ----
	document.addEventListener('paste', (e) => {
		const clipItems = e.clipboardData?.items;
		if (!clipItems) return;
		for (const ci of clipItems) {
			if (ci.type.startsWith('image/')) {
				e.preventDefault();
				const blob = ci.getAsFile();
				if (!blob) return;
				const reader = new FileReader();
				reader.onload = () => {
					const base64 = reader.result.split(',')[1];
					// Place at viewport center in canvas coordinates
					const rect = viewport.getBoundingClientRect();
					const cx = (-camX + rect.width / 2) / scale;
					const cy = (-camY + rect.height / 2) / scale;
					vscodeApi.postMessage({ type: 'saveImage', data: base64, x: cx, y: cy });
				};
				reader.readAsDataURL(blob);
				return;
			}
		}
	});

	// ---- Drop ----
	viewport.addEventListener('dragover', (e) => { e.preventDefault(); });
	viewport.addEventListener('drop', (e) => {
		e.preventDefault();
		const files = e.dataTransfer?.files;
		if (!files) return;
		const rect = viewport.getBoundingClientRect();
		const dropX = (-camX + (e.clientX - rect.left)) / scale;
		const dropY = (-camY + (e.clientY - rect.top)) / scale;

		for (const file of files) {
			if (file.type.startsWith('image/')) {
				const reader = new FileReader();
				reader.onload = () => {
					const base64 = reader.result.split(',')[1];
					vscodeApi.postMessage({ type: 'requestDrop', data: base64, fileName: file.name, x: dropX, y: dropY });
				};
				reader.readAsDataURL(file);
			}
		}
	});

	// ---- Add Images button ----
	document.getElementById('btnAddFiles').addEventListener('click', () => {
		const rect = viewport.getBoundingClientRect();
		const cx = (-camX + rect.width / 2) / scale;
		const cy = (-camY + rect.height / 2) / scale;
		vscodeApi.postMessage({ type: 'pickFiles', cx, cy });
	});

	// ---- Messages from extension ----
	window.addEventListener('message', (e) => {
		const msg = e.data;
		if (msg.type === 'imageAdded') {
			const item = {
				id: newId(),
				filePath: msg.filePath,
				webviewUri: msg.webviewUri,
				x: msg.x ?? 100,
				y: msg.y ?? 100,
				width: 300,
				height: 200,
			};
			items.push(item);
			createItemElement(item);
			saveState();
		} else if (msg.type === 'uriResolved') {
			// not used currently
		}
	});

	// ---- Save state ----
	let saveTimer;
	function saveState() {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			vscodeApi.postMessage({
				type: 'updateState',
				canvasX: camX,
				canvasY: camY,
				canvasScale: scale,
				items: items.map(i => ({
					id: i.id,
					filePath: i.filePath,
					x: i.x,
					y: i.y,
					width: i.width,
					height: i.height,
				})),
			});
		}, 300);
	}
})();
</script>
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
