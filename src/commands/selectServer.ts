import * as vscode from 'vscode';
import type { JupyterServerConfig } from '../jupyter/types';
import type { ServerTreeElement } from '../explorer/serverTree';
import type { ServerManager } from '../servers/serverManager';

interface ServerQuickPickItem extends vscode.QuickPickItem {
  readonly server: JupyterServerConfig;
}

export async function selectServer(
  manager: ServerManager,
  candidate?: ServerTreeElement | JupyterServerConfig
): Promise<JupyterServerConfig | undefined> {
  if (candidate && 'kind' in candidate) {
    return candidate.server;
  }
  if (candidate && 'id' in candidate) {
    return candidate;
  }

  const items: ServerQuickPickItem[] = manager.getServers().map((server) => ({
    label: server.name,
    description: server.baseUrl,
    server
  }));
  if (items.length === 0) {
    void vscode.window.showInformationMessage('No Jupyter servers have been added yet.');
    return undefined;
  }
  return (await vscode.window.showQuickPick(items, {
    title: 'Select a Jupyter server',
    placeHolder: 'Jupyter server'
  }))?.server;
}
