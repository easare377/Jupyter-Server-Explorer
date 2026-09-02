import * as vscode from 'vscode';
import { toJupyterUri } from '../filesystem/uri';
import type { JupyterServerConfig } from '../jupyter/types';
import type { ServerTreeElement } from '../explorer/serverTree';
import type { ServerManager } from '../servers/serverManager';
import { selectServer } from './selectServer';

export async function openRemoteFolder(
  manager: ServerManager,
  candidate?: ServerTreeElement | JupyterServerConfig
): Promise<void> {
  const server = await selectServer(manager, candidate);
  if (!server) {
    return;
  }
  const uri = toJupyterUri(server.id);
  const existing = vscode.workspace.workspaceFolders?.find((folder) => folder.uri.toString() === uri.toString());
  if (existing) {
    void vscode.window.showInformationMessage(`"${server.name}" is already open as a workspace folder.`);
    return;
  }
  const index = vscode.workspace.workspaceFolders?.length ?? 0;
  const updated = vscode.workspace.updateWorkspaceFolders(index, 0, { uri, name: server.name });
  if (!updated) {
    throw new Error(`VS Code could not add "${server.name}" to the current workspace.`);
  }
}
