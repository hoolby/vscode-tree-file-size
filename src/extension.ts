import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
const ignore = require("ignore");

// Create output channel for debugging
const outputChannel = vscode.window.createOutputChannel("Tree File Size");

/**
 * Loads and parses .gitignore from the workspace root.
 * Returns an ignore matcher or null if not found or disabled.
 */
async function getGitignoreMatcher(): Promise<any | null> {
  const config = vscode.workspace.getConfiguration("treeFileSize");
  const respectGitignore = config.get<boolean>("respectGitignore", true);
  if (!respectGitignore) return null;
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) return null;
  const rootPath = workspaceFolders[0].uri.fsPath;
  const gitignorePath = path.join(rootPath, ".gitignore");
  try {
    const content = await fs.promises.readFile(gitignorePath, "utf8");
    const ig = ignore();
    ig.add(content);
    outputChannel.appendLine("Loaded .gitignore patterns");
    return ig;
  } catch (e) {
    outputChannel.appendLine("No .gitignore found or failed to load");
    return null;
  }
}

/**
 * Formats a file size in bytes to a human-readable string for tooltip
 * @param bytes - The size in bytes
 * @returns Formatted size string
 */
function formatTooltip(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${
    units[unitIndex]
  }`;
}

/**
 * Gets the size of a file or directory, optionally respecting .gitignore
 * @param filePath - Path to the file or directory
 * @param ig - ignore matcher or null
 * @param root - workspace root path for relative matching
 * @returns Size in bytes
 */
async function getSize(
  filePath: string,
  ig: any | null,
  root: string
): Promise<number> {
  outputChannel.appendLine(`Getting size for: ${filePath}`);
  try {
    const stats = await fs.promises.stat(filePath);
    if (stats.isDirectory()) {
      const files = await fs.promises.readdir(filePath);
      let totalSize = 0;
      for (const file of files) {
        const fullPath = path.join(filePath, file);
        const relPath = path.relative(root, fullPath);
        // If .gitignore is enabled and matches, skip
        if (ig && ig.ignores(relPath.replace(/\\/g, "/"))) {
          outputChannel.appendLine(`Ignored by .gitignore: ${relPath}`);
          continue;
        }
        totalSize += await getSize(fullPath, ig, root);
      }
      outputChannel.appendLine(
        `Directory ${filePath} total size: ${totalSize} bytes`
      );
      return totalSize;
    }
    outputChannel.appendLine(`File ${filePath} size: ${stats.size} bytes`);
    return stats.size;
  } catch (error) {
    outputChannel.appendLine(`Error getting size for ${filePath}: ${error}`);
    return 0;
  }
}

/**
 * Updates the file size decoration for a file or directory
 * @param fileDecorationProvider - The decoration provider
 * @param uri - The URI of the file or directory
 * @param ig - ignore matcher or null
 * @param root - workspace root path for relative matching
 */
async function updateFileSizeDecoration(
  fileDecorationProvider: FileDecorationProvider,
  uri: vscode.Uri,
  ig: any | null,
  root: string
): Promise<void> {
  outputChannel.appendLine(`Updating decoration for: ${uri.fsPath}`);
  try {
    const size = await getSize(uri.fsPath, ig, root);
    const tooltip = formatTooltip(size);
    outputChannel.appendLine(`Setting tooltip for ${uri.fsPath}: ${tooltip}`);
    fileDecorationProvider.updateDecoration(uri, tooltip);
  } catch (error) {
    outputChannel.appendLine(
      `Error updating decoration for ${uri.fsPath}: ${error}`
    );
  }
}

/**
 * Custom decoration provider for file sizes
 */
class FileDecorationProvider implements vscode.FileDecorationProvider {
  private decorations = new Map<string, string>();
  private _onDidChangeFileDecorations = new vscode.EventEmitter<
    vscode.Uri | vscode.Uri[]
  >();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  /**
   * Updates the decoration for a specific URI
   * @param uri - The URI to update
   * @param tooltip - The detailed size information
   */
  updateDecoration(uri: vscode.Uri, tooltip: string): void {
    outputChannel.appendLine(
      `Updating decoration map for ${uri.toString()}: tooltip=${tooltip}`
    );
    this.decorations.set(uri.toString(), tooltip);
    this._onDidChangeFileDecorations.fire(uri);
  }

  /**
   * Provides the decoration for a file or directory
   * @param uri - The URI of the file or directory
   * @returns The decoration to display
   */
  provideFileDecoration(
    uri: vscode.Uri
  ): vscode.ProviderResult<vscode.FileDecoration> {
    const tooltip = this.decorations.get(uri.toString());
    outputChannel.appendLine(
      `Providing decoration for ${uri.toString()}: tooltip=${tooltip || "none"}`
    );
    if (!tooltip) {
      return null;
    }
    return {
      tooltip: `Size: ${tooltip}`,
      propagate: false,
      // No badge, only tooltip
    };
  }
}

/**
 * Recursively collect all directories under a given root
 * @param dir - Directory to start from
 * @param ig - ignore matcher or null
 * @param root - workspace root path for relative matching
 * @returns Array of directory paths
 */
async function getAllDirectories(
  dir: string,
  ig: any | null,
  root: string
): Promise<string[]> {
  let dirs: string[] = [dir];
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(root, fullPath);
        if (ig && ig.ignores(relPath.replace(/\\/g, "/"))) {
          outputChannel.appendLine(
            `Ignored directory by .gitignore: ${relPath}`
          );
          continue;
        }
        dirs = dirs.concat(await getAllDirectories(fullPath, ig, root));
      }
    }
  } catch (e) {
    // Ignore errors
  }
  return dirs;
}

/**
 * Activates the extension
 * @param context - The extension context
 */
export function activate(context: vscode.ExtensionContext): void {
  outputChannel.appendLine("Tree File Size extension is now active!");

  const fileDecorationProvider = new FileDecorationProvider();
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(fileDecorationProvider)
  );

  let ig: any | null = null;
  let root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";

  async function refreshGitignore() {
    ig = await getGitignoreMatcher();
    root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
  }

  // Initial load of .gitignore
  refreshGitignore().then(async () => {
    const fileUris = await vscode.workspace.findFiles("**/*");
    outputChannel.appendLine(`Found ${fileUris.length} files to process`);
    fileUris.forEach((uri) =>
      updateFileSizeDecoration(fileDecorationProvider, uri, ig, root)
    );
    // Also decorate all folders
    if (root) {
      const allDirs = await getAllDirectories(root, ig, root);
      outputChannel.appendLine(`Found ${allDirs.length} folders to process`);
      allDirs.forEach((dir) => {
        const dirUri = vscode.Uri.file(dir);
        updateFileSizeDecoration(fileDecorationProvider, dirUri, ig, root);
      });
    }
  });

  // Update decorations when the explorer view changes
  const updateDecorations = async (uri: vscode.Uri) => {
    await updateFileSizeDecoration(fileDecorationProvider, uri, ig, root);
  };

  // Watch for file system changes
  const fileSystemWatcher = vscode.workspace.createFileSystemWatcher("**/*");
  context.subscriptions.push(fileSystemWatcher);

  fileSystemWatcher.onDidCreate(updateDecorations);
  fileSystemWatcher.onDidChange(updateDecorations);
  fileSystemWatcher.onDidDelete((uri) => {
    fileDecorationProvider.updateDecoration(uri, "");
  });

  // Update decorations when configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("treeFileSize")) {
        outputChannel.appendLine("Configuration changed, updating decorations");
        refreshGitignore().then(async () => {
          const fileUris = await vscode.workspace.findFiles("**/*");
          fileUris.forEach((uri) =>
            updateFileSizeDecoration(fileDecorationProvider, uri, ig, root)
          );
          // Also decorate all folders
          if (root) {
            const allDirs = await getAllDirectories(root, ig, root);
            allDirs.forEach((dir) => {
              const dirUri = vscode.Uri.file(dir);
              updateFileSizeDecoration(
                fileDecorationProvider,
                dirUri,
                ig,
                root
              );
            });
          }
        });
      }
    })
  );

  // Force refresh of explorer view
  vscode.commands.executeCommand("workbench.files.action.refreshFilesExplorer");
}

/**
 * Deactivates the extension
 */
export function deactivate(): void {
  outputChannel.appendLine("Tree File Size extension is now deactivated");
  outputChannel.dispose();
}
