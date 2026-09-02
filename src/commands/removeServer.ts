import * as vscode from 'vscode';
import type { JupyterServerConfig } from '../jupyter/types';
import type { ServerTreeElement } from '../explorer/serverTree';
import type { ServerManager } from '../servers/serverManager';
import { selectServer } from './selectServer';

export async function removeServer(
  manager: ServerManager,
  candidate?: ServerTreeElement | JupyterServerConfig
): Promise<void> {
  const server = await selectServer(manager, candidate);
  if (!server) {
    return;
  }
  const confirmation = await vscode.window.showWarningMessage(
    `Remove Jupyter server "${server.name}"? Its stored credentials will also be deleted. `
      + 'Remote files will not be changed.',
    { modal: true },
    'Remove'
  );
  if (confirmation !== 'Remove') {
    return;
  }
  await manager.removeServer(server);
}
