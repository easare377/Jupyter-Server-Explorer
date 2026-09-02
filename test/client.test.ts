import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import test, { after, before } from 'node:test';
import { JupyterClient, JupyterRequestError } from '../src/jupyter/client';
import type { JupyterContentModel, JupyterServerConfig } from '../src/jupyter/types';

interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly authorization?: string;
  readonly body?: unknown;
}

const requests: RecordedRequest[] = [];
const server = createServer((request, response) => {
  void handleRequest(request, response);
});
let baseUrl = '';

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Test server did not expose a TCP port.');
  }
  baseUrl = `http://127.0.0.1:${address.port}/prefix/`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

void test('reads binary files through base64 and preserves base paths and auth headers', async () => {
  requests.length = 0;
  const client = createClient();
  const result = await client.readFile('data/a b.bin');

  assert.deepEqual([...result.data], [0, 1, 2, 255]);
  assert.equal(requests[0]?.method, 'GET');
  assert.equal(requests[0]?.url, '/prefix/api/contents/data/a%20b.bin?content=1&format=base64');
  assert.equal(requests[0]?.authorization, 'token test-token');
});

void test('writes notebooks as notebook JSON and renames with PATCH', async () => {
  requests.length = 0;
  const client = createClient();
  const notebook = { cells: [], metadata: { test: true }, nbformat: 4, nbformat_minor: 5 };

  await client.writeFile('notebooks/test.ipynb', Buffer.from(JSON.stringify(notebook)));
  await client.rename('notebooks/test.ipynb', 'notebooks/renamed.ipynb');

  assert.deepEqual(requests[0]?.body, {
    type: 'notebook',
    format: 'json',
    content: notebook
  });
  assert.equal(requests[1]?.method, 'PATCH');
  assert.deepEqual(requests[1]?.body, { path: 'notebooks/renamed.ipynb' });
});

void test('maps binary writes, directory creation, and deletion to the Contents API', async () => {
  requests.length = 0;
  const client = createClient();

  await client.writeFile('data/raw.bin', Uint8Array.from([0, 255]));
  await client.createDirectory('new folder');
  await client.delete('new folder');

  assert.equal(requests[0]?.method, 'PUT');
  assert.deepEqual(requests[0]?.body, {
    type: 'file',
    format: 'base64',
    content: 'AP8='
  });
  assert.equal(requests[1]?.url, '/prefix/api/contents/new%20folder');
  assert.deepEqual(requests[1]?.body, { type: 'directory' });
  assert.equal(requests[2]?.method, 'DELETE');
});

void test('uses the longer write timeout for slow notebook-server saves', async () => {
  const client = createClient(10, 250);
  await client.writeFile('slow-write.bin', Uint8Array.from([1, 2, 3]));
});

void test('surfaces Jupyter HTTP failures with status and server detail', async () => {
  const client = createClient();
  await assert.rejects(
    client.getContents('missing', false),
    (error: unknown) => error instanceof JupyterRequestError
      && error.status === 404
      && /No such file/.test(error.message)
  );
});

function createClient(readTimeout = 2_000, writeTimeout = 2_000): JupyterClient {
  const config: JupyterServerConfig = {
    id: 'test-server',
    name: 'Test Server',
    baseUrl,
    authentication: 'token'
  };
  return new JupyterClient(
    config,
    () => Promise.resolve({ Authorization: 'token test-token' }),
    readTimeout,
    writeTimeout
  );
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const bodyText = await readBody(request);
  const recorded: RecordedRequest = {
    method: request.method ?? '',
    url: request.url ?? '',
    ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}),
    ...(bodyText ? { body: JSON.parse(bodyText) as unknown } : {})
  };
  requests.push(recorded);

  if (request.url?.includes('/missing')) {
    json(response, 404, { message: 'No such file' });
    return;
  }
  if (request.method === 'GET' && request.url?.includes('a%20b.bin')) {
    json(response, 200, model('data/a b.bin', 'file', Buffer.from([0, 1, 2, 255]).toString('base64'), 'base64'));
    return;
  }
  if (request.method === 'DELETE') {
    response.writeHead(204).end();
    return;
  }
  if (request.method === 'PUT' && request.url?.endsWith('/new%20folder')) {
    json(response, 201, model('new folder', 'directory', null, null));
    return;
  }
  if (request.method === 'PUT' && request.url?.endsWith('/slow-write.bin')) {
    await new Promise((resolve) => setTimeout(resolve, 60));
    json(response, 201, model('slow-write.bin', 'file', '', 'base64'));
    return;
  }
  const requestedPath = request.url?.includes('/data/raw.bin') ? 'data/raw.bin' : 'notebooks/test.ipynb';
  const requestedType = requestedPath.endsWith('.bin') ? 'file' : 'notebook';
  json(
    response,
    request.method === 'PUT' ? 201 : 200,
    model(requestedPath, requestedType, requestedType === 'file' ? '' : {}, requestedType === 'file' ? 'base64' : 'json')
  );
}

function model(
  path: string,
  type: JupyterContentModel['type'],
  content: JupyterContentModel['content'],
  format: JupyterContentModel['format']
): JupyterContentModel {
  return {
    name: path.split('/').at(-1) ?? '',
    path,
    type,
    content,
    format,
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
