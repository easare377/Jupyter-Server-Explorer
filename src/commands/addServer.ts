import * as vscode from 'vscode';
import { parseServerUrl } from '../jupyter/paths';
import type { ServerManager } from '../servers/serverManager';
import { confirmInsecurePassword, pickAuthentication, promptCredential } from './authenticationInput';

export async function addServer(manager: ServerManager): Promise<void> {
  const name = await vscode.window.showInputBox({
    title: 'Add Jupyter Server (1/3)',
    prompt: 'Server name',
    placeHolder: 'GPU Server',
    ignoreFocusOut: true,
    validateInput: (value) => value.trim() ? undefined : 'Enter a server name.'
  });
  if (name === undefined) {
    return;
  }

  const rawUrl = await vscode.window.showInputBox({
    title: 'Add Jupyter Server (2/3)',
    prompt: 'Jupyter server base URL (include a base path if the server uses one)',
    placeHolder: 'http://127.0.0.1:8888',
    ignoreFocusOut: true,
    validateInput: (value) => {
      try {
        parseServerUrl(value);
        return undefined;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }
  });
  if (rawUrl === undefined) {
    return;
  }

  const parsedUrl = parseServerUrl(rawUrl);
  const authentication = await pickAuthentication(
    'Add Jupyter Server (3/3)',
    Boolean(parsedUrl.token)
  );
  if (!authentication) {
    return;
  }

  if (!await confirmInsecurePassword(parsedUrl.baseUrl, authentication)) {
    return;
  }
  const credential = await promptCredential(
    authentication,
    authentication === 'password' ? 'Jupyter Server Password' : 'Jupyter Server Token',
    parsedUrl.token
  );
  if (authentication !== 'none' && credential === undefined) {
    return;
  }

  const server = await manager.addServer({
    name,
    url: parsedUrl.baseUrl,
    authentication,
    credential
  });

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Connecting to ${server.name}…` },
    async () => {
      try {
        await manager.testConnection(server);
        void vscode.window.showInformationMessage(`Connected to Jupyter server "${server.name}".`);
      } catch (error) {
        const choice = await vscode.window.showWarningMessage(
          `Saved "${server.name}", but the connection test failed: ${message(error)}`,
          'Keep Server',
          'Remove Server'
        );
        if (choice === 'Remove Server') {
          await manager.removeServer(server);
        }
      }
    }
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
