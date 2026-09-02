import * as vscode from 'vscode';
import { registerCommands } from './commands/registerCommands';
import { ServerTreeDataProvider } from './explorer/serverTree';
import { JupyterFileSystemProvider } from './filesystem/provider';
import { JUPYTER_SCHEME } from './filesystem/uri';
import { JupyterIntegration } from './jupyter/jupyterIntegration';
import { ServerManager } from './servers/serverManager';

export function activate(context: vscode.ExtensionContext): void {
  const manager = new ServerManager(context);
  const fileSystem = new JupyterFileSystemProvider(manager);
  const tree = new ServerTreeDataProvider(manager);
  const jupyterIntegration = new JupyterIntegration(context, manager);

  context.subscriptions.push(
    manager,
    fileSystem,
    tree,
    jupyterIntegration,
    vscode.workspace.registerFileSystemProvider(JUPYTER_SCHEME, fileSystem, {
      isCaseSensitive: true,
      isReadonly: false
    }),
    vscode.window.createTreeView('jupyterRemote.servers', {
      treeDataProvider: tree,
      showCollapseAll: true
    })
  );

  registerCommands(context, manager, fileSystem, tree);
}

export function deactivate(): void {}
