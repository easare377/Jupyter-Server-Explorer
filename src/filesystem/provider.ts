import * as vscode from 'vscode';
import { JupyterRequestError } from '../jupyter/client';
import type { JupyterContentModel } from '../jupyter/types';
import type { ServerManager } from '../servers/serverManager';
import {
  jupyterPathFromUri,
  parentUri,
  serverIdFromUri,
  toJupyterUri
} from './uri';

export class JupyterFileSystemProvider implements vscode.FileSystemProvider, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  private readonly statCache = new Map<string, vscode.FileStat>();

  public readonly onDidChangeFile = this.changeEmitter.event;

  public constructor(private readonly servers: ServerManager) {}

  public watch(): vscode.Disposable {
    // Jupyter's Contents API has no filesystem change stream. Changes made through
    // this provider emit events; external changes become visible on manual refresh.
    return new vscode.Disposable(() => undefined);
  }

  public async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    try {
      const path = jupyterPathFromUri(uri);
      const client = this.servers.clientForId(serverIdFromUri(uri));
      const model = await client.getContents(path, false);
      let size = model.size ?? this.statCache.get(uri.toString())?.size;
      if (size === undefined && model.type !== 'directory') {
        size = (await client.readFile(path)).data.byteLength;
      }
      const stat = modelToStat(model, size ?? 0);
      this.statCache.set(uri.toString(), stat);
      return stat;
    } catch (error) {
      throw mapFileSystemError(error, uri);
    }
  }

  public async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    try {
      const client = this.servers.clientForId(serverIdFromUri(uri));
      const models = await client.listDirectory(jupyterPathFromUri(uri));
      return models
        .map((model): [string, vscode.FileType] => [model.name, modelToFileType(model)])
        .sort(([left], [right]) => left.localeCompare(right));
    } catch (error) {
      throw mapFileSystemError(error, uri);
    }
  }

  public async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    try {
      const client = this.servers.clientForId(serverIdFromUri(uri));
      const remoteFile = await client.readFile(jupyterPathFromUri(uri));
      this.statCache.set(uri.toString(), modelToStat(remoteFile.model, remoteFile.data.byteLength));
      return remoteFile.data;
    } catch (error) {
      throw mapFileSystemError(error, uri);
    }
  }

  public async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { readonly create: boolean; readonly overwrite: boolean }
  ): Promise<void> {
    try {
      const existing = await this.tryStat(uri);
      if (!existing && !options.create) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      if (existing && existing.type === vscode.FileType.Directory) {
        throw vscode.FileSystemError.FileIsADirectory(uri);
      }
      if (existing && !options.overwrite) {
        throw vscode.FileSystemError.FileExists(uri);
      }

      await this.ensureParentDirectory(uri);
      const client = this.servers.clientForId(serverIdFromUri(uri));
      const model = await client.writeFile(jupyterPathFromUri(uri), content);
      this.statCache.set(uri.toString(), modelToStat(model, content.byteLength));
      this.fire([
        { type: existing ? vscode.FileChangeType.Changed : vscode.FileChangeType.Created, uri },
        { type: vscode.FileChangeType.Changed, uri: parentUri(uri) }
      ]);
    } catch (error) {
      throw mapFileSystemError(error, uri);
    }
  }

  public async createDirectory(uri: vscode.Uri): Promise<void> {
    try {
      if (await this.tryStat(uri)) {
        throw vscode.FileSystemError.FileExists(uri);
      }
      await this.ensureParentDirectory(uri);
      const client = this.servers.clientForId(serverIdFromUri(uri));
      const model = await client.createDirectory(jupyterPathFromUri(uri));
      this.statCache.set(uri.toString(), modelToStat(model, 0));
      this.fire([
        { type: vscode.FileChangeType.Created, uri },
        { type: vscode.FileChangeType.Changed, uri: parentUri(uri) }
      ]);
    } catch (error) {
      throw mapFileSystemError(error, uri);
    }
  }

  public async delete(
    uri: vscode.Uri,
    options: { readonly recursive: boolean }
  ): Promise<void> {
    try {
      if (!jupyterPathFromUri(uri)) {
        throw vscode.FileSystemError.NoPermissions('The Jupyter server root cannot be deleted.');
      }
      await this.deleteInternal(uri, options.recursive);
      this.fire([
        { type: vscode.FileChangeType.Deleted, uri },
        { type: vscode.FileChangeType.Changed, uri: parentUri(uri) }
      ]);
    } catch (error) {
      throw mapFileSystemError(error, uri);
    }
  }

  public async rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { readonly overwrite: boolean }
  ): Promise<void> {
    try {
      const oldServerId = serverIdFromUri(oldUri);
      if (oldServerId !== serverIdFromUri(newUri)) {
        throw vscode.FileSystemError.NoPermissions('Renaming across Jupyter servers is not supported.');
      }
      if (!jupyterPathFromUri(oldUri) || !jupyterPathFromUri(newUri)) {
        throw vscode.FileSystemError.NoPermissions('The Jupyter server root cannot be renamed.');
      }
      if (oldUri.toString() === newUri.toString()) {
        return;
      }

      await this.stat(oldUri);
      await this.ensureParentDirectory(newUri);
      const destination = await this.tryStat(newUri);
      if (destination && !options.overwrite) {
        throw vscode.FileSystemError.FileExists(newUri);
      }
      if (destination) {
        await this.deleteInternal(newUri, true);
      }

      const client = this.servers.clientForId(oldServerId);
      const model = await client.rename(jupyterPathFromUri(oldUri), jupyterPathFromUri(newUri));
      this.statCache.delete(oldUri.toString());
      this.statCache.set(newUri.toString(), modelToStat(model, model.size ?? 0));
      this.fire([
        { type: vscode.FileChangeType.Deleted, uri: oldUri },
        { type: vscode.FileChangeType.Created, uri: newUri },
        { type: vscode.FileChangeType.Changed, uri: parentUri(oldUri) },
        { type: vscode.FileChangeType.Changed, uri: parentUri(newUri) }
      ]);
    } catch (error) {
      throw mapFileSystemError(error, oldUri);
    }
  }

  public refresh(uri?: vscode.Uri): void {
    if (uri) {
      this.statCache.delete(uri.toString());
      this.fire([{ type: vscode.FileChangeType.Changed, uri }]);
      return;
    }

    this.statCache.clear();
    const events = this.servers.getServers().map((server) => ({
      type: vscode.FileChangeType.Changed,
      uri: toJupyterUri(server.id)
    }));
    this.fire(events);
  }

  public dispose(): void {
    this.changeEmitter.dispose();
    this.statCache.clear();
  }

  private async ensureParentDirectory(uri: vscode.Uri): Promise<void> {
    const parent = parentUri(uri);
    if (parent.toString() === uri.toString()) {
      return;
    }
    const parentStat = await this.stat(parent);
    if (parentStat.type !== vscode.FileType.Directory) {
      throw vscode.FileSystemError.FileNotADirectory(parent);
    }
  }

  private async tryStat(uri: vscode.Uri): Promise<vscode.FileStat | undefined> {
    try {
      return await this.stat(uri);
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
        return undefined;
      }
      throw error;
    }
  }

  private async deleteInternal(uri: vscode.Uri, recursive: boolean): Promise<void> {
    const stat = await this.stat(uri);
    if (stat.type === vscode.FileType.Directory) {
      const children = await this.readDirectory(uri);
      if (children.length > 0 && !recursive) {
        throw new vscode.FileSystemError('Directory is not empty.');
      }
      for (const [name] of children) {
        await this.deleteInternal(vscode.Uri.joinPath(uri, name), true);
      }
    }

    const client = this.servers.clientForId(serverIdFromUri(uri));
    await client.delete(jupyterPathFromUri(uri));
    this.statCache.delete(uri.toString());
  }

  private fire(events: vscode.FileChangeEvent[]): void {
    if (events.length > 0) {
      this.changeEmitter.fire(events);
    }
  }
}

function modelToFileType(model: JupyterContentModel): vscode.FileType {
  return model.type === 'directory' ? vscode.FileType.Directory : vscode.FileType.File;
}

function modelToStat(model: JupyterContentModel, size: number): vscode.FileStat {
  return {
    type: modelToFileType(model),
    ctime: parseTimestamp(model.created),
    mtime: parseTimestamp(model.last_modified),
    size,
    permissions: model.writable ? undefined : vscode.FilePermission.Readonly
  };
}

function parseTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function mapFileSystemError(error: unknown, uri: vscode.Uri): Error {
  if (error instanceof vscode.FileSystemError) {
    return error;
  }
  if (error instanceof JupyterRequestError) {
    if (error.status === 404) {
      return vscode.FileSystemError.FileNotFound(uri);
    }
    if (error.status === 401 || error.status === 403) {
      return vscode.FileSystemError.NoPermissions(error.message);
    }
    if (error.status === 409 || /already exists|file exists/i.test(error.responseBody ?? '')) {
      return vscode.FileSystemError.FileExists(uri);
    }
    return new vscode.FileSystemError(error.message);
  }
  return vscode.FileSystemError.Unavailable(
    error instanceof Error ? error.message : String(error)
  );
}
