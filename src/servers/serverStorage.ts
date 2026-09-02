import type * as vscode from 'vscode';
import { parseServerUrl } from '../jupyter/paths';
import type { JupyterServerConfig } from '../jupyter/types';

const SERVER_STATE_KEY = 'jupyterRemote.servers.v1';

export class ServerStorage {
  public constructor(private readonly globalState: vscode.Memento) {}

  public getAll(): readonly JupyterServerConfig[] {
    return this.globalState
      .get<readonly JupyterServerConfig[]>(SERVER_STATE_KEY, [])
      .map((server) => ({ ...server, baseUrl: normalizedStoredUrl(server.baseUrl) }));
  }

  public async save(server: JupyterServerConfig): Promise<void> {
    const servers = this.getAll().filter((candidate) => candidate.id !== server.id);
    servers.push(server);
    servers.sort((left, right) => left.name.localeCompare(right.name));
    await this.globalState.update(SERVER_STATE_KEY, servers);
  }

  public async remove(serverId: string): Promise<void> {
    const servers = this.getAll().filter((server) => server.id !== serverId);
    await this.globalState.update(SERVER_STATE_KEY, servers);
  }
}

function normalizedStoredUrl(baseUrl: string): string {
  try {
    return parseServerUrl(baseUrl).baseUrl;
  } catch {
    return baseUrl;
  }
}
