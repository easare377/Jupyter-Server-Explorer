import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import test, { after, before } from 'node:test';
import type { SecretStorage } from 'vscode';
import { AuthenticationService } from '../src/jupyter/authentication';
import { JupyterClient } from '../src/jupyter/client';
import type { JupyterContentModel, JupyterServerConfig } from '../src/jupyter/types';

class MemorySecretStorage {
  private readonly values = new Map<string, string>();

  public get(key: string): Promise<string | undefined> {
    return Promise.resolve(this.values.get(key));
  }

  public store(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }

  public delete(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }
}

const secrets = new MemorySecretStorage();
const authentication = new AuthenticationService(secrets as unknown as SecretStorage);
let acceptedPassword = 'correct horse';
let baseUrl = '';
let loginCount = 0;
let rejectNextApiRequest = false;

const server = createServer((request, response) => {
  void handleRequest(request, response);
});

const config: JupyterServerConfig = {
  id: 'password-server',
  name: 'Password Server',
  baseUrl,
  authentication: 'password'
};

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Test server did not expose a TCP port.');
  }
  baseUrl = `http://127.0.0.1:${address.port}/prefix/`;
  Object.assign(config, { baseUrl });
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

void test('logs in with a password and uses cookie and XSRF headers for API requests', async () => {
  loginCount = 0;
  await authentication.storeCredential(config, acceptedPassword);

  const model = await createClient().getContents('', false);

  assert.equal(model.type, 'directory');
  assert.equal(loginCount, 1);
});

void test('changing a password invalidates the old login session', async () => {
  acceptedPassword = 'updated password';
  await authentication.storeCredential(config, acceptedPassword);

  await createClient().getContents('', false);

  assert.equal(loginCount, 2);
  assert.equal(await authentication.getCredential(config), acceptedPassword);
});

void test('re-authenticates once when a password session expires', async () => {
  rejectNextApiRequest = true;

  await createClient().getContents('', false);

  assert.equal(loginCount, 3);
});

void test('reports a rejected Jupyter password without exposing it', async () => {
  await authentication.storeCredential(config, 'not the password');

  await assert.rejects(
    createClient().getContents('', false),
    (error: unknown) => error instanceof Error
      && /password.*was rejected/i.test(error.message)
      && !error.message.includes('not the password')
  );
});

void test('replaces stored tokens without retaining them in server metadata', async () => {
  const tokenServer: JupyterServerConfig = {
    ...config,
    id: 'token-server',
    authentication: 'token'
  };
  await authentication.storeCredential(tokenServer, 'old-token');
  await authentication.storeCredential(tokenServer, 'new-token');

  assert.equal(await authentication.getCredential(tokenServer), 'new-token');
  assert.equal('credential' in tokenServer, false);
});

function createClient(): JupyterClient {
  return new JupyterClient(
    config,
    (forceRefresh, signal) => authentication.getHeaders(config, { forceRefresh, signal }),
    2_000,
    2_000
  );
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', baseUrl);
  if (url.pathname === '/prefix/login' && request.method === 'GET') {
    response.writeHead(200, {
      'Content-Type': 'text/html',
      'Set-Cookie': '_xsrf=xsrf%7Cvalue; Path=/prefix/'
    });
    response.end('<form></form>');
    return;
  }

  if (url.pathname === '/prefix/login' && request.method === 'POST') {
    const form = new URLSearchParams(await readBody(request));
    assert.equal(form.get('_xsrf'), 'xsrf|value');
    assert.match(request.headers.cookie ?? '', /_xsrf=xsrf%7Cvalue/);
    if (form.get('password') !== acceptedPassword) {
      response.writeHead(401, { 'Content-Type': 'text/html' }).end('Invalid credentials');
      return;
    }
    loginCount += 1;
    response.writeHead(302, {
      Location: '/prefix/',
      'Set-Cookie': 'username-test=signed-session; Path=/prefix/; HttpOnly'
    }).end();
    return;
  }

  if (url.pathname === '/prefix/api/contents') {
    if (rejectNextApiRequest) {
      rejectNextApiRequest = false;
      response.writeHead(403, { 'Content-Type': 'application/json' }).end('{"message":"Forbidden"}');
      return;
    }
    assert.match(request.headers.cookie ?? '', /_xsrf=xsrf%7Cvalue/);
    assert.match(request.headers.cookie ?? '', /username-test=signed-session/);
    assert.equal(request.headers['x-xsrftoken'], 'xsrf|value');
    json(response, 200, directoryModel());
    return;
  }

  response.writeHead(404).end();
}

function directoryModel(): JupyterContentModel {
  return {
    name: '',
    path: '',
    type: 'directory',
    content: null,
    format: 'json',
    writable: true,
    created: '2026-01-01T00:00:00Z',
    last_modified: '2026-01-01T00:00:00Z',
    mimetype: null,
    size: null
  };
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
}
