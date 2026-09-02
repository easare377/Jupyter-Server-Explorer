import * as vscode from 'vscode';
import type { JupyterServerConfig } from '../jupyter/types';
import type { ServerTreeElement } from '../explorer/serverTree';
import type { ServerManager } from '../servers/serverManager';
import { confirmInsecurePassword, pickAuthentication, promptCredential } from './authenticationInput';
import { selectServer } from './selectServer';

export async function updateCredentials(
  manager: ServerManager,
  candidate?: ServerTreeElement | JupyterServerConfig
): Promise<void> {
  const server = await selectServer(manager, candidate);
  if (!server) {
    return;
  }

  const authentication = await pickAuthentication(
    `Update Credentials: ${server.name}`,
    false,
    server.authentication
  );
  if (!authentication || !await confirmInsecurePassword(server.baseUrl, authentication)) {
    return;
  }

  const credential = await promptCredential(
    authentication,
    `Update Credentials: ${server.name}`
  );
  if (authentication !== 'none' && credential === undefined) {
    return;
  }

  let previousCredential: string | undefined;
  try {
    previousCredential = await manager.getCredential(server);
  } catch {
    // A missing old credential should not prevent the user from replacing it.
  }

  let updated: JupyterServerConfig;
  try {
    updated = await manager.updateAuthentication(server, authentication, credential);
  } catch (error) {
    void vscode.window.showErrorMessage(`Unable to update credentials: ${message(error)}`);
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Testing updated credentials for ${server.name}…`
    },
    async () => {
      try {
        await manager.testConnection(updated);
        void vscode.window.showInformationMessage(`Updated credentials for "${server.name}".`);
      } catch (error) {
        const canRestore = server.authentication === 'none' || previousCredential !== undefined;
        const choice = await vscode.window.showWarningMessage(
          `Credentials were saved, but the connection test failed: ${message(error)}`,
          'Keep Credentials',
          ...(canRestore ? ['Restore Previous'] : [])
        );
        if (choice === 'Restore Previous') {
          await manager.updateAuthentication(updated, server.authentication, previousCredential);
          void vscode.window.showInformationMessage(`Restored previous credentials for "${server.name}".`);
        }
      }
    }
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
