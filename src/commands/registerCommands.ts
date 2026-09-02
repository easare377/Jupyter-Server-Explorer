import * as vscode from 'vscode';
import type { ServerTreeDataProvider, ServerTreeElement } from '../explorer/serverTree';
import type { JupyterFileSystemProvider } from '../filesystem/provider';
import type { JupyterServerConfig } from '../jupyter/types';
import type { ServerManager } from '../servers/serverManager';
import { addServer } from './addServer';
import { connectServer } from './connectServer';
import { openRemoteFolder } from './openRemoteFolder';
import { openResource } from './openResource';
import { removeServer } from './removeServer';
import { updateCredentials } from './updateCredentials';

type ServerCandidate = ServerTreeElement | JupyterServerConfig | undefined;

export function registerCommands(
  context: vscode.ExtensionContext,
  manager: ServerManager,
  fileSystem: JupyterFileSystemProvider,
  tree: ServerTreeDataProvider
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('jupyterRemote.addServer', () => addServer(manager)),
    vscode.commands.registerCommand(
      'jupyterRemote.removeServer',
      (candidate?: ServerCandidate) => removeServer(manager, candidate)
    ),
    vscode.commands.registerCommand(
      'jupyterRemote.connectServer',
      (candidate?: ServerCandidate) => connectServer(manager, candidate)
    ),
    vscode.commands.registerCommand(
      'jupyterRemote.updateCredentials',
      (candidate?: ServerCandidate) => updateCredentials(manager, candidate)
    ),
    vscode.commands.registerCommand(
      'jupyterRemote.openRemoteFolder',
      (candidate?: ServerCandidate) => openRemoteFolder(manager, candidate)
    ),
    vscode.commands.registerCommand('jupyterRemote.openResource', (uri: vscode.Uri) => openResource(uri)),
    vscode.commands.registerCommand('jupyterRemote.refresh', (element?: ServerTreeElement) => {
      tree.refresh(element);
      if (element?.kind === 'server') {
        fileSystem.refresh(vscode.Uri.from({ scheme: 'jupyter', authority: element.server.id, path: '/' }));
      } else {
        fileSystem.refresh();
      }
    })
  );
}
