import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { AuthenticationService } from '../jupyter/authentication';
import { JupyterClient } from '../jupyter/client';
import { parseServerUrl } from '../jupyter/paths';
import type { AuthenticationType, JupyterServerConfig } from '../jupyter/types';
import { ServerStorage } from './serverStorage';

export interface AddServerInput {
  readonly name: string;
  readonly url: string;
  readonly authentication: AuthenticationType;
  readonly credential?: string;
}

export class ServerManager implements vscode.Disposable {
  private readonly storage: ServerStorage;
  private readonly authentication: AuthenticationService;
  private readonly serverChangeEmitter = new vscode.EventEmitter<void>();

  public readonly onDidChangeServers = this.serverChangeEmitter.event;

  public constructor(context: vscode.ExtensionContext) {
    this.storage = new ServerStorage(context.globalState);
    this.authentication = new AuthenticationService(context.secrets);
  }

  public getServers(): readonly JupyterServerConfig[] {
    return this.storage.getAll();
  }

  public getServer(serverId: string): JupyterServerConfig | undefined {
    return this.getServers().find((server) => server.id === serverId);
  }

  public async addServer(input: AddServerInput): Promise<JupyterServerConfig> {
    const name = input.name.trim();
    if (!name) {
      throw new Error('Server name cannot be empty.');
    }
    const parsedUrl = parseServerUrl(input.url);
    const server: JupyterServerConfig = {
      id: randomUUID(),
      name,
      baseUrl: parsedUrl.baseUrl,
      authentication: input.authentication
    };

    await this.storage.save(server);
    try {
      await this.authentication.storeCredential(server, input.credential ?? parsedUrl.token);
    } catch (error) {
      await this.storage.remove(server.id);
      throw error;
    }
    this.serverChangeEmitter.fire();
    return server;
  }

  public async removeServer(server: JupyterServerConfig): Promise<void> {
    await this.authentication.clearCredentials(server);
    await this.storage.remove(server.id);
    this.serverChangeEmitter.fire();
  }

  public clientFor(server: JupyterServerConfig): JupyterClient {
    const configuration = vscode.workspace.getConfiguration('jupyterRemote');
    const timeout = configuration.get<number>('requestTimeout', 30_000);
    const writeTimeout = configuration.get<number>('writeRequestTimeout', 180_000);
    return new JupyterClient(
      server,
      (forceRefresh, signal) => this.authentication.getHeaders(server, { forceRefresh, signal }),
      timeout,
      writeTimeout
    );
  }

  public getCredential(server: JupyterServerConfig): Promise<string | undefined> {
    return this.authentication.getCredential(server);
  }

  public getAuthenticationHeaders(
    server: JupyterServerConfig,
    forceRefresh = false,
    signal?: AbortSignal
  ): Promise<Record<string, string>> {
    return this.authentication.getHeaders(server, { forceRefresh, signal });
  }

  public async updateAuthentication(
    server: JupyterServerConfig,
    authentication: AuthenticationType,
    credential?: string
  ): Promise<JupyterServerConfig> {
    const updated: JupyterServerConfig = { ...server, authentication };
    await this.authentication.storeCredential(updated, credential);
    await this.storage.save(updated);
    await this.authentication.clearCredentialsExcept(updated, authentication);
    this.serverChangeEmitter.fire();
    return updated;
  }

  public clientForId(serverId: string): JupyterClient {
    const server = this.getServer(serverId);
    if (!server) {
      throw new Error(`Unknown Jupyter server id: ${serverId}`);
    }
    return this.clientFor(server);
  }

  public async testConnection(server: JupyterServerConfig): Promise<void> {
    const client = this.clientFor(server);
    await client.getContents('', false);
  }

  public dispose(): void {
    this.serverChangeEmitter.dispose();
  }
}
