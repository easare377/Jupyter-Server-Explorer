import type {
  Jupyter,
  JupyterServer,
  JupyterServerConnectionInformation
} from '@vscode/jupyter-extension';
import * as vscode from 'vscode';
import type { ServerManager } from '../servers/serverManager';
import type { JupyterServerConfig } from './types';

const JUPYTER_EXTENSION_ID = 'ms-toolsai.jupyter';

/**
 * Publishes this extension's saved servers to the Microsoft Jupyter extension's
 * stable server-collection API. Registration is deferred until a Jupyter
 * notebook opens so ordinary filesystem browsing does not activate the much
 * larger kernel extension unnecessarily.
 */
export class JupyterIntegration implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private registration: vscode.Disposable | undefined;
  private registrationPromise: Promise<void> | undefined;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly servers: ServerManager
  ) {
    this.disposables.push(
      vscode.workspace.onDidOpenNotebookDocument((document) => {
        if (document.notebookType === 'jupyter-notebook') {
          void this.ensureRegistered();
        }
      })
    );

    if (vscode.workspace.notebookDocuments.some((document) => document.notebookType === 'jupyter-notebook')) {
      void this.ensureRegistered();
    }
  }

  public dispose(): void {
    this.registration?.dispose();
    vscode.Disposable.from(...this.disposables).dispose();
  }

  private ensureRegistered(): Promise<void> {
    if (this.registration) {
      return Promise.resolve();
    }
    this.registrationPromise ??= this.register().finally(() => {
      this.registrationPromise = undefined;
    });
    return this.registrationPromise;
  }

  private async register(): Promise<void> {
    const extension = vscode.extensions.getExtension<Jupyter>(JUPYTER_EXTENSION_ID);
    if (!extension) {
      void vscode.window.showWarningMessage(
        'Install the Microsoft Jupyter extension to discover kernels on saved Jupyter Remote servers.'
      );
      return;
    }

    const jupyter = extension.isActive ? extension.exports : await extension.activate();
    const collection = jupyter.createJupyterServerCollection(
      `${this.context.extension.id}:servers`,
      'Jupyter Remote Servers',
      {
        onDidChangeServers: this.servers.onDidChangeServers,
        provideJupyterServers: () => this.provideServers(),
        resolveJupyterServer: (server, token) => this.resolveServer(server, token)
      }
    );
    collection.documentation = vscode.Uri.joinPath(this.context.extensionUri, 'README.md');
    this.registration = collection;
  }

  private async provideServers(): Promise<JupyterServer[]> {
    return await Promise.all(this.servers.getServers().map(async (server): Promise<JupyterServer> => {
      const item: JupyterServer = { id: server.id, label: server.name };
      return server.authentication === 'password'
        ? item
        : { ...item, connectionInformation: await this.connectionInformation(server) };
    }));
  }

  private async resolveServer(
    candidate: JupyterServer,
    cancellationToken: vscode.CancellationToken
  ): Promise<JupyterServer> {
    const server = this.servers.getServer(candidate.id);
    if (!server) {
      return candidate;
    }

    const abortController = new AbortController();
    const cancellation = cancellationToken.onCancellationRequested(() => abortController.abort());
    try {
      return {
        id: server.id,
        label: server.name,
        connectionInformation: await this.connectionInformation(server, abortController.signal)
      };
    } finally {
      cancellation.dispose();
    }
  }

  private async connectionInformation(
    server: JupyterServerConfig,
    signal?: AbortSignal
  ): Promise<JupyterServerConnectionInformation> {
    const baseUrl = vscode.Uri.parse(server.baseUrl);
    if (server.authentication === 'token') {
      return { baseUrl, token: await this.servers.getCredential(server) };
    }
    if (server.authentication === 'password') {
      return { baseUrl, headers: await this.servers.getAuthenticationHeaders(server, false, signal) };
    }
    return { baseUrl };
  }
}
