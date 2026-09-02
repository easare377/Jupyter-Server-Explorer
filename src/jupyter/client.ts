import { Buffer } from 'node:buffer';
import { encodeJupyterPath, normalizeJupyterPath } from './paths';
import type {
  JupyterContentModel,
  JupyterServerConfig,
  JupyterStatus,
  RemoteFile
} from './types';

type HeaderProvider = (
  forceRefresh?: boolean,
  signal?: AbortSignal
) => Promise<Record<string, string>>;

export class JupyterRequestError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody?: string
  ) {
    super(message);
    this.name = 'JupyterRequestError';
  }
}

export class JupyterClient {
  public constructor(
    public readonly server: JupyterServerConfig,
    private readonly getAuthenticationHeaders: HeaderProvider,
    private readonly timeoutMilliseconds = 30_000,
    private readonly writeTimeoutMilliseconds = 180_000
  ) {}

  public getStatus(): Promise<JupyterStatus> {
    return this.request<JupyterStatus>('GET', this.apiUrl('api/status'));
  }

  public getContents(path: string, includeContent: boolean): Promise<JupyterContentModel> {
    const url = this.contentsUrl(path);
    url.searchParams.set('content', includeContent ? '1' : '0');
    return this.request<JupyterContentModel>('GET', url);
  }

  public async listDirectory(path: string): Promise<readonly JupyterContentModel[]> {
    const model = await this.getContents(path, true);
    if (model.type !== 'directory' || !Array.isArray(model.content)) {
      throw new JupyterRequestError(`Remote path is not a directory: ${path}`, 400);
    }
    return model.content;
  }

  public async readFile(path: string): Promise<RemoteFile> {
    const normalizedPath = normalizeJupyterPath(path);
    const url = this.contentsUrl(normalizedPath);
    url.searchParams.set('content', '1');
    if (!normalizedPath.toLowerCase().endsWith('.ipynb')) {
      url.searchParams.set('format', 'base64');
    }

    const model = await this.request<JupyterContentModel>('GET', url);
    if (model.type === 'directory') {
      throw new JupyterRequestError(`Remote path is a directory: ${path}`, 400);
    }

    if (model.type === 'notebook' || model.format === 'json') {
      if (!model.content || typeof model.content !== 'object' || Array.isArray(model.content)) {
        throw new JupyterRequestError(`Jupyter returned invalid notebook content for ${path}.`, 500);
      }
      const data = Buffer.from(`${JSON.stringify(model.content, null, 2)}\n`, 'utf8');
      return { data, model };
    }

    if (typeof model.content !== 'string') {
      throw new JupyterRequestError(`Jupyter returned invalid file content for ${path}.`, 500);
    }

    const data = model.format === 'base64'
      ? Buffer.from(model.content, 'base64')
      : Buffer.from(model.content, 'utf8');
    return { data, model };
  }

  public writeFile(path: string, content: Uint8Array): Promise<JupyterContentModel> {
    const normalizedPath = normalizeJupyterPath(path);
    if (normalizedPath.toLowerCase().endsWith('.ipynb')) {
      return this.writeNotebook(normalizedPath, content);
    }

    return this.request<JupyterContentModel>('PUT', this.contentsUrl(normalizedPath), {
      type: 'file',
      format: 'base64',
      content: Buffer.from(content).toString('base64')
    }, this.writeTimeoutMilliseconds);
  }

  public createDirectory(path: string): Promise<JupyterContentModel> {
    return this.request<JupyterContentModel>('PUT', this.contentsUrl(path), {
      type: 'directory'
    }, this.writeTimeoutMilliseconds);
  }

  public rename(oldPath: string, newPath: string): Promise<JupyterContentModel> {
    return this.request<JupyterContentModel>('PATCH', this.contentsUrl(oldPath), {
      path: normalizeJupyterPath(newPath)
    }, this.writeTimeoutMilliseconds);
  }

  public async delete(path: string): Promise<void> {
    await this.request<void>('DELETE', this.contentsUrl(path), undefined, this.writeTimeoutMilliseconds);
  }

  private writeNotebook(path: string, content: Uint8Array): Promise<JupyterContentModel> {
    let notebook: Record<string, unknown>;
    const text = Buffer.from(content).toString('utf8').trim();
    try {
      notebook = text
        ? JSON.parse(text) as Record<string, unknown>
        : { cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 };
    } catch (error) {
      throw new Error(`Cannot save ${path}: the notebook is not valid JSON.`, { cause: error });
    }

    return this.request<JupyterContentModel>('PUT', this.contentsUrl(path), {
      type: 'notebook',
      format: 'json',
      content: notebook
    }, this.writeTimeoutMilliseconds);
  }

  private apiUrl(relativePath: string): URL {
    return new URL(relativePath, this.server.baseUrl);
  }

  private contentsUrl(path: string): URL {
    const encodedPath = encodeJupyterPath(path);
    return this.apiUrl(`api/contents${encodedPath ? `/${encodedPath}` : ''}`);
  }

  private async request<T>(
    method: string,
    url: URL,
    body?: unknown,
    timeoutMilliseconds = this.timeoutMilliseconds
  ): Promise<T> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), timeoutMilliseconds);
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const authenticationHeaders = await this.getAuthenticationHeaders(
          attempt > 0,
          abortController.signal
        );
        const response = await fetch(url, {
          method,
          headers: {
            Accept: 'application/json',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...authenticationHeaders
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: abortController.signal
        });

        if (
          attempt === 0
          && this.server.authentication === 'password'
          && (response.status === 401 || response.status === 403)
        ) {
          await response.arrayBuffer();
          continue;
        }

        if (!response.ok) {
          const responseBody = await response.text();
          throw new JupyterRequestError(
            this.errorMessage(method, url, response.status, response.statusText, responseBody),
            response.status,
            responseBody
          );
        }

        if (response.status === 204) {
          return undefined as T;
        }
        return await response.json() as T;
      }
      throw new Error('Jupyter authentication retry did not produce a response.');
    } catch (error) {
      if (error instanceof JupyterRequestError) {
        throw error;
      }
      if (abortController.signal.aborted) {
        throw new Error(`Jupyter request timed out after ${timeoutMilliseconds} ms: ${method} ${url}`);
      }
      throw new Error(`Unable to reach Jupyter server ${this.server.baseUrl}: ${errorMessage(error)}`, {
        cause: error
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private errorMessage(
    method: string,
    url: URL,
    status: number,
    statusText: string,
    responseBody: string
  ): string {
    let detail = responseBody.trim();
    try {
      const parsed = JSON.parse(responseBody) as { message?: unknown; reason?: unknown };
      const candidate = parsed.message ?? parsed.reason;
      if (typeof candidate === 'string') {
        detail = candidate;
      }
    } catch {
      // The server is allowed to return a non-JSON error page.
    }
    const suffix = detail ? `: ${detail}` : '';
    return `Jupyter request failed (${status} ${statusText}) for ${method} ${url.pathname}${suffix}`;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
