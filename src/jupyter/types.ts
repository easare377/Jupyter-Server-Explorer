export type AuthenticationType = 'none' | 'token' | 'password';

export interface JupyterServerConfig {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly authentication: AuthenticationType;
}

export type JupyterContentType = 'directory' | 'file' | 'notebook';
export type JupyterContentFormat = 'text' | 'base64' | 'json' | null;

export interface JupyterContentModel {
  readonly name: string;
  readonly path: string;
  readonly type: JupyterContentType;
  readonly writable: boolean;
  readonly created: string;
  readonly last_modified: string;
  readonly mimetype: string | null;
  readonly format: JupyterContentFormat;
  readonly size: number | null;
  readonly content: string | Record<string, unknown> | JupyterContentModel[] | null;
}

export interface JupyterStatus {
  readonly connections: number;
  readonly kernels: number;
  readonly last_activity: string;
  readonly started: string;
}

export interface RemoteFile {
  readonly data: Uint8Array;
  readonly model: JupyterContentModel;
}
