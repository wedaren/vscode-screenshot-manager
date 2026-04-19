"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const galleryViewProvider_1 = require("./galleryViewProvider");
const boardEditorProvider_1 = require("./boardEditorProvider");
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
function getSaveDirectory() {
    const config = vscode.workspace.getConfiguration('screenshotManager');
    const configured = config.get('saveDirectory', '');
    if (configured) {
        return configured.replace(/^~/, os.homedir());
    }
    return path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/Screenshots');
}
function activate(context) {
    const provider = new galleryViewProvider_1.GalleryViewProvider(context.extensionUri, getSaveDirectory);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('screenshotManager.gallery', provider, {
        webviewOptions: { retainContextWhenHidden: true },
    }));
    // FileSystemWatcher on save directory
    let watcher;
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
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('screenshotManager.saveDirectory')) {
            provider.updateGetSaveDirectory(getSaveDirectory);
            setupWatcher();
            provider.refresh();
        }
    }));
    // Commands
    context.subscriptions.push(vscode.commands.registerCommand('screenshotManager.copyPath', (filePath) => {
        vscode.env.clipboard.writeText(filePath);
        vscode.window.showInformationMessage('Path copied to clipboard');
    }));
    context.subscriptions.push(vscode.commands.registerCommand('screenshotManager.revealInFinder', (filePath) => {
        vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(filePath));
    }));
    context.subscriptions.push(vscode.commands.registerCommand('screenshotManager.deleteScreenshot', async (filePath) => {
        const confirm = await vscode.window.showWarningMessage(`Delete ${path.basename(filePath)}?`, { modal: true }, 'Delete');
        if (confirm === 'Delete') {
            try {
                await vscode.workspace.fs.delete(vscode.Uri.file(filePath));
            }
            catch {
                vscode.window.showErrorMessage(`Failed to delete ${path.basename(filePath)}`);
            }
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('screenshotManager.refreshGallery', () => {
        provider.refresh();
    }));
    // Investigation Board
    const board = new boardEditorProvider_1.BoardEditorProvider(context.extensionUri, getSaveDirectory);
    context.subscriptions.push(vscode.commands.registerCommand('screenshotManager.openBoard', () => {
        board.open();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('screenshotManager.addToBoard', (filePath) => {
        board.addImageToBoard(filePath);
    }));
}
function deactivate() { }
//# sourceMappingURL=extension.js.map