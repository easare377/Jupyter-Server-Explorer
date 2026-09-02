import * as vscode from 'vscode';
import type { AuthenticationType } from '../jupyter/types';

interface AuthenticationQuickPickItem extends vscode.QuickPickItem {
  readonly authentication: AuthenticationType;
}

export async function pickAuthentication(
  title: string,
  tokenIncludedInUrl = false,
  current?: AuthenticationType
): Promise<AuthenticationType | undefined> {
  const items: AuthenticationQuickPickItem[] = [
    {
      label: 'Token',
      description: tokenIncludedInUrl
        ? 'Use the token included in the URL'
        : 'Store a Jupyter token securely',
      detail: current === 'token' ? 'Currently selected' : undefined,
      authentication: 'token'
    },
    {
      label: 'Password',
      description: 'Standard single-user Jupyter Server password',
      detail: current === 'password' ? 'Currently selected' : undefined,
      authentication: 'password'
    },
    {
      label: 'None',
      description: 'Use only for a server that has authentication disabled',
      detail: current === 'none' ? 'Currently selected' : undefined,
      authentication: 'none'
    }
  ];
  const selected = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: 'Authentication method',
    ignoreFocusOut: true
  });
  return selected?.authentication;
}

export async function promptCredential(
  authentication: AuthenticationType,
  title: string,
  tokenFromUrl?: string
): Promise<string | undefined> {
  if (authentication === 'none') {
    return undefined;
  }
  if (authentication === 'token' && tokenFromUrl) {
    return tokenFromUrl;
  }

  const credentialName = authentication === 'password' ? 'password' : 'token';
  return await vscode.window.showInputBox({
    title,
    prompt: `New Jupyter Server ${credentialName} (stored in VS Code SecretStorage)`,
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => value.length > 0 ? undefined : `Enter a ${credentialName}.`
  });
}

export async function confirmInsecurePassword(
  baseUrl: string,
  authentication: AuthenticationType
): Promise<boolean> {
  if (authentication !== 'password' || new URL(baseUrl).protocol !== 'http:') {
    return true;
  }
  const choice = await vscode.window.showWarningMessage(
    'This Jupyter server uses HTTP. Its password will be transmitted without TLS encryption. '
      + 'Continue only on a trusted private network.',
    { modal: true },
    'Continue'
  );
  return choice === 'Continue';
}
