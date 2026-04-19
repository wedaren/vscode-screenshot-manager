import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { GalleryViewProvider } from './galleryViewProvider';
import { BoardEditorProvider } from './boardEditorProvider';

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

function getSaveDirectory(): string {
	const config = vscode.workspace.getConfiguration('screenshotManager');
	const configured = config.get<string>('saveDirectory', '');
	if (configured) {
		return configured.replace(/^~/, os.homedir());
	}
	return path.join(
		os.homedir(),
		'Library/Mobile Documents/com~apple~CloudDocs/Screenshots'
	);
}

export function activate(context: vscode.ExtensionContext) {
	const provider = new GalleryViewProvider(context.extensionUri, getSaveDirectory);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('screenshotManager.gallery', provider, {
			webviewOptions: { retainContextWhenHidden: true },
		})
	);

	// FileSystemWatcher on save directory
	let watcher: vscode.FileSystemWatcher | undefined;

	function setupWatcher() {
		watcher?.dispose();
		const dir = getSaveDirectory();
		const pattern = new vscode.RelativePattern(vscode.Uri.file(dir), '*.{png,jpg,jpeg,gif,webp}');
		watcher = vscode.workspace.createFileSystemWatcher(pattern);

		const refresh = () => provider.refresh();
		watcher.onDidCreate(refresh);
		watcher.onDidDelete(refresh);
		watcher.onDidChange(refresh);

		context.subscriptions.push(watcher);
	}

	setupWatcher();

	// Re-setup watcher when configuration changes
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('screenshotManager.saveDirectory')) {
				provider.updateGetSaveDirectory(getSaveDirectory);
				setupWatcher();
				provider.refresh();
			}
		})
	);

	// Commands
	context.subscriptions.push(
		vscode.commands.registerCommand('screenshotManager.copyPath', (filePath: string) => {
			vscode.env.clipboard.writeText(filePath);
			vscode.window.showInformationMessage('Path copied to clipboard');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('screenshotManager.revealInFinder', (filePath: string) => {
			vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(filePath));
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('screenshotManager.deleteScreenshot', async (filePath: string) => {
			const confirm = await vscode.window.showWarningMessage(
				`Delete ${path.basename(filePath)}?`,
				{ modal: true },
				'Delete'
			);
			if (confirm === 'Delete') {
				try {
					await vscode.workspace.fs.delete(vscode.Uri.file(filePath));
				} catch {
					vscode.window.showErrorMessage(`Failed to delete ${path.basename(filePath)}`);
				}
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('screenshotManager.refreshGallery', () => {
			provider.refresh();
		})
	);

	// Investigation Board
	const board = new BoardEditorProvider(context.extensionUri, getSaveDirectory);

	context.subscriptions.push(
		vscode.commands.registerCommand('screenshotManager.openBoard', () => {
			board.open();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('screenshotManager.addToBoard', (filePath: string) => {
			board.addImageToBoard(filePath);
		})
	);
}

export function deactivate() {}
