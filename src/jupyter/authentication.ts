import type * as vscode from 'vscode';
import { normalizeJupyterToken } from './paths';
import type { AuthenticationType, JupyterServerConfig } from './types';

interface AuthenticationRequestOptions {
  readonly forceRefresh?: boolean;
  readonly signal?: AbortSignal;
}

interface AuthenticationProvider {
  readonly type: AuthenticationType;
  getHeaders(
    server: JupyterServerConfig,
    options?: AuthenticationRequestOptions
  ): Promise<Record<string, string>>;
  getCredential(server: JupyterServerConfig): Promise<string | undefined>;
  storeCredential(server: JupyterServerConfig, credential?: string): Promise<void>;
  clearCredential(server: JupyterServerConfig): Promise<void>;
  invalidate(server: JupyterServerConfig): void;
}

class NoAuthenticationProvider implements AuthenticationProvider {
  public readonly type = 'none' as const;

  public getHeaders(): Promise<Record<string, string>> {
    return Promise.resolve({});
  }

  public getCredential(): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  public async storeCredential(): Promise<void> {}

  public async clearCredential(): Promise<void> {}

  public invalidate(): void {}
}

class TokenAuthenticationProvider implements AuthenticationProvider {
  public readonly type = 'token' as const;

  public constructor(private readonly secrets: vscode.SecretStorage) {}

  public async getHeaders(server: JupyterServerConfig): Promise<Record<string, string>> {
    const token = await this.getCredential(server);
    return { Authorization: `token ${token}` };
  }

  public async getCredential(server: JupyterServerConfig): Promise<string> {
    const storedToken = await this.secrets.get(this.secretKey(server.id));
    if (!storedToken) {
      throw new Error(`No token is stored for Jupyter server "${server.name}".`);
    }
    return normalizeJupyterToken(storedToken);
  }

  public async storeCredential(server: JupyterServerConfig, credential?: string): Promise<void> {
    if (!credential) {
      throw new Error('A token is required for token authentication.');
    }
    await this.secrets.store(this.secretKey(server.id), normalizeJupyterToken(credential));
  }

  public async clearCredential(server: JupyterServerConfig): Promise<void> {
    await this.secrets.delete(this.secretKey(server.id));
  }

  public invalidate(): void {}

  private secretKey(serverId: string): string {
    return `jupyterRemote.server.${serverId}.token`;
  }
}

interface PasswordSession {
  readonly cookies: ReadonlyMap<string, string>;
  readonly xsrfToken?: string;
}

class PasswordAuthenticationProvider implements AuthenticationProvider {
  public readonly type = 'password' as const;
  private readonly sessions = new Map<string, PasswordSession>();

  public constructor(private readonly secrets: vscode.SecretStorage) {}

  public async getHeaders(
    server: JupyterServerConfig,
    options: AuthenticationRequestOptions = {}
  ): Promise<Record<string, string>> {
    if (options.forceRefresh) {
      this.invalidate(server);
    }
    const session = this.sessions.get(server.id) ?? await this.login(server, options.signal);
    return sessionHeaders(session);
  }

  public async getCredential(server: JupyterServerConfig): Promise<string> {
    const password = await this.secrets.get(this.secretKey(server.id));
    if (!password) {
      throw new Error(`No password is stored for Jupyter server "${server.name}".`);
    }
    return password;
  }

  public async storeCredential(server: JupyterServerConfig, credential?: string): Promise<void> {
    if (!credential) {
      throw new Error('A password is required for password authentication.');
    }
    await this.secrets.store(this.secretKey(server.id), credential);
    this.invalidate(server);
  }

  public async clearCredential(server: JupyterServerConfig): Promise<void> {
    this.invalidate(server);
    await this.secrets.delete(this.secretKey(server.id));
  }

  public invalidate(server: JupyterServerConfig): void {
    this.sessions.delete(server.id);
  }

  private async login(server: JupyterServerConfig, signal?: AbortSignal): Promise<PasswordSession> {
    const password = await this.getCredential(server);
    const loginUrl = new URL('login', server.baseUrl);
    loginUrl.searchParams.set('next', new URL(server.baseUrl).pathname);

    const cookies = new Map<string, string>();
    const loginPage = await fetch(loginUrl, {
      method: 'GET',
      headers: { Accept: 'text/html' },
      redirect: 'manual',
      signal
    });
    recordResponseCookies(loginPage.headers, cookies);
    await loginPage.arrayBuffer();

    if (loginPage.status >= 300 && loginPage.status < 400) {
      throw new Error(
        `Jupyter server "${server.name}" redirected away from the standard password login form. `
        + 'JupyterHub, SSO, and other interactive login providers are not supported.'
      );
    }
    if (!loginPage.ok) {
      throw new Error(
        `Unable to open the Jupyter password login form (${loginPage.status} ${loginPage.statusText}).`
      );
    }

    const xsrfToken = decodedXsrfToken(cookies.get('_xsrf'));
    const form = new URLSearchParams({
      password,
      next: new URL(server.baseUrl).pathname
    });
    if (xsrfToken) {
      form.set('_xsrf', xsrfToken);
    }

    const loginResponse = await fetch(loginUrl, {
      method: 'POST',
      headers: {
        Accept: 'text/html',
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(cookies.size === 0 ? {} : { Cookie: cookieHeader(cookies) }),
        ...(xsrfToken ? { 'X-XSRFToken': xsrfToken } : {})
      },
      body: form.toString(),
      redirect: 'manual',
      signal
    });
    recordResponseCookies(loginResponse.headers, cookies);
    await loginResponse.arrayBuffer();

    if (loginResponse.status === 401 || loginResponse.status === 403) {
      throw new Error(`The password for Jupyter server "${server.name}" was rejected.`);
    }
    if (loginResponse.status < 300 || loginResponse.status >= 400) {
      throw new Error(
        `Jupyter server "${server.name}" did not complete password login `
        + `(${loginResponse.status} ${loginResponse.statusText}).`
      );
    }

    const session: PasswordSession = {
      cookies,
      xsrfToken: decodedXsrfToken(cookies.get('_xsrf'))
    };
    this.sessions.set(server.id, session);
    return session;
  }

  private secretKey(serverId: string): string {
    return `jupyterRemote.server.${serverId}.password`;
  }
}

export class AuthenticationService {
  private readonly providers: ReadonlyMap<AuthenticationType, AuthenticationProvider>;

  public constructor(secrets: vscode.SecretStorage) {
    const providers: AuthenticationProvider[] = [
      new NoAuthenticationProvider(),
      new TokenAuthenticationProvider(secrets),
      new PasswordAuthenticationProvider(secrets)
    ];
    this.providers = new Map(providers.map((provider) => [provider.type, provider]));
  }

  public getHeaders(
    server: JupyterServerConfig,
    options?: AuthenticationRequestOptions
  ): Promise<Record<string, string>> {
    return this.provider(server.authentication).getHeaders(server, options);
  }

  public getCredential(server: JupyterServerConfig): Promise<string | undefined> {
    return this.provider(server.authentication).getCredential(server);
  }

  public storeCredential(server: JupyterServerConfig, credential?: string): Promise<void> {
    return this.provider(server.authentication).storeCredential(server, credential);
  }

  public async clearCredentials(server: JupyterServerConfig): Promise<void> {
    await Promise.all([...this.providers.values()].map((provider) => provider.clearCredential(server)));
  }

  public async clearCredentialsExcept(
    server: JupyterServerConfig,
    authentication: AuthenticationType
  ): Promise<void> {
    await Promise.all(
      [...this.providers.values()]
        .filter((provider) => provider.type !== authentication)
        .map((provider) => provider.clearCredential(server))
    );
    this.provider(authentication).invalidate(server);
  }

  public invalidate(server: JupyterServerConfig): void {
    this.provider(server.authentication).invalidate(server);
  }

  private provider(type: AuthenticationType): AuthenticationProvider {
    const provider = this.providers.get(type);
    if (!provider) {
      throw new Error(`Unsupported authentication type: ${String(type)}`);
    }
    return provider;
  }
}

function sessionHeaders(session: PasswordSession): Record<string, string> {
  return {
    Cookie: cookieHeader(session.cookies),
    ...(session.xsrfToken ? { 'X-XSRFToken': session.xsrfToken } : {})
  };
}

function cookieHeader(cookies: ReadonlyMap<string, string>): string {
  return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function decodedXsrfToken(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return decodeURIComponent(value.replace(/^"|"$/g, ''));
  } catch {
    return value;
  }
}

function recordResponseCookies(headers: Headers, cookies: Map<string, string>): void {
  for (const header of setCookieHeaders(headers)) {
    const pair = header.split(';', 1)[0] ?? '';
    const separator = pair.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (/max-age=0/i.test(header) || !value) {
      cookies.delete(name);
    } else {
      cookies.set(name, value);
    }
  }
}

function setCookieHeaders(headers: Headers): readonly string[] {
  const cookieHeaders = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof cookieHeaders.getSetCookie === 'function') {
    return cookieHeaders.getSetCookie();
  }
  const combined = headers.get('set-cookie');
  return combined ? combined.split(/,(?=\s*[^;,\s]+=)/) : [];
}
