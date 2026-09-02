import * as vscode from 'vscode';
import type { JupyterServerConfig } from '../jupyter/types';
import type { ServerTreeElement } from '../explorer/serverTree';
import type { ServerManager } from '../servers/serverManager';
import { selectServer } from './selectServer';

export async function connectServer(
  manager: ServerManager,
  candidate?: ServerTreeElement | JupyterServerConfig
): Promise<void> {
  const server = await selectServer(manager, candidate);
  if (!server) {
    return;
  }
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Testing ${server.name}…` },
    async () => {
      try {
        await manager.testConnection(server);
        void vscode.window.showInformationMessage(`Jupyter server "${server.name}" is reachable.`);
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Cannot connect to "${server.name}": ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );
}
