import * as vscode from 'vscode';
import type { JupyterContentModel, JupyterServerConfig } from '../jupyter/types';
import type { ServerManager } from '../servers/serverManager';
import { toJupyterUri } from '../filesystem/uri';

export type ServerTreeElement = ServerNode | ContentNode | ErrorNode;

export interface ServerNode {
  readonly kind: 'server';
  readonly server: JupyterServerConfig;
}

export interface ContentNode {
  readonly kind: 'content';
  readonly server: JupyterServerConfig;
  readonly model: JupyterContentModel;
}

export interface ErrorNode {
  readonly kind: 'error';
  readonly server: JupyterServerConfig;
  readonly message: string;
}

export class ServerTreeDataProvider implements vscode.TreeDataProvider<ServerTreeElement>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<ServerTreeElement | undefined>();
  private readonly serverChangeSubscription: vscode.Disposable;

  public readonly onDidChangeTreeData = this.changeEmitter.event;

  public constructor(private readonly servers: ServerManager) {
    this.serverChangeSubscription = servers.onDidChangeServers(() => this.refresh());
  }

  public getTreeItem(element: ServerTreeElement): vscode.TreeItem {
    if (element.kind === 'server') {
      const item = new vscode.TreeItem(element.server.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.id = `server:${element.server.id}`;
      item.description = new URL(element.server.baseUrl).host;
      item.tooltip = `${element.server.name}\n${element.server.baseUrl}`;
      item.iconPath = new vscode.ThemeIcon('remote');
      item.contextValue = 'jupyterRemote.server';
      return item;
    }

    if (element.kind === 'error') {
      const item = new vscode.TreeItem(element.message, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('warning');
      item.tooltip = element.message;
      item.contextValue = 'jupyterRemote.error';
      return item;
    }

    const uri = toJupyterUri(element.server.id, element.model.path);
    const isDirectory = element.model.type === 'directory';
    const item = new vscode.TreeItem(
      uri,
      isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );
    item.id = `content:${element.server.id}:${element.model.path}`;
    item.contextValue = isDirectory
      ? 'jupyterRemote.directory'
      : element.model.type === 'notebook'
        ? 'jupyterRemote.notebook'
        : 'jupyterRemote.file';
    item.tooltip = `${element.server.name}: /${element.model.path}`;
    if (!isDirectory) {
      item.command = {
        command: 'jupyterRemote.openResource',
        title: 'Open Remote File',
        arguments: [uri]
      };
    }
    return item;
  }

  public async getChildren(element?: ServerTreeElement): Promise<ServerTreeElement[]> {
    if (!element) {
      return this.servers.getServers().map((server) => ({ kind: 'server', server }));
    }
    if (element.kind === 'error') {
      return [];
    }

    const server = element.server;
    const path = element.kind === 'server' ? '' : element.model.path;
    if (element.kind === 'content' && element.model.type !== 'directory') {
      return [];
    }

    try {
      const models = await this.servers.clientFor(server).listDirectory(path);
      return [...models]
        .sort(compareContentModels)
        .map((model) => ({ kind: 'content', server, model }));
    } catch (error) {
      return [{
        kind: 'error',
        server,
        message: error instanceof Error ? error.message : String(error)
      }];
    }
  }

  public refresh(element?: ServerTreeElement): void {
    this.changeEmitter.fire(element);
  }

  public dispose(): void {
    this.serverChangeSubscription.dispose();
    this.changeEmitter.dispose();
  }
}

function compareContentModels(left: JupyterContentModel, right: JupyterContentModel): number {
  if (left.type === 'directory' && right.type !== 'directory') {
    return -1;
  }
  if (left.type !== 'directory' && right.type === 'directory') {
    return 1;
  }
  return left.name.localeCompare(right.name);
}
