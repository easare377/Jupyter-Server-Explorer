import { posix } from 'node:path';
import * as vscode from 'vscode';
import { normalizeJupyterPath } from '../jupyter/paths';

export const JUPYTER_SCHEME = 'jupyter';

export function serverIdFromUri(uri: vscode.Uri): string {
  if (uri.scheme !== JUPYTER_SCHEME || !uri.authority) {
    throw vscode.FileSystemError.Unavailable(`Invalid Jupyter URI: ${uri.toString()}`);
  }
  return uri.authority;
}

export function jupyterPathFromUri(uri: vscode.Uri): string {
  serverIdFromUri(uri);
  try {
    return normalizeJupyterPath(uri.path);
  } catch (error) {
    throw vscode.FileSystemError.NoPermissions(
      error instanceof Error ? error.message : String(error)
    );
  }
}

export function toJupyterUri(serverId: string, path = ''): vscode.Uri {
  const normalizedPath = normalizeJupyterPath(path);
  return vscode.Uri.from({
    scheme: JUPYTER_SCHEME,
    authority: serverId,
    path: `/${normalizedPath}`
  });
}

export function parentUri(uri: vscode.Uri): vscode.Uri {
  const parentPath = posix.dirname(uri.path);
  return uri.with({ path: parentPath === '.' ? '/' : parentPath });
}
