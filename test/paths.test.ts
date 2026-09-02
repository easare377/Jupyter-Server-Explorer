import assert from 'node:assert/strict';
import test from 'node:test';
import {
  encodeJupyterPath,
  normalizeJupyterPath,
  parentJupyterPath,
  parseServerUrl
} from '../src/jupyter/paths';

void test('normalizes and encodes Jupyter paths by segment', () => {
  assert.equal(normalizeJupyterPath('/folder/a b#c.py'), 'folder/a b#c.py');
  assert.equal(encodeJupyterPath('/folder/a b#c.py'), 'folder/a%20b%23c.py');
  assert.equal(parentJupyterPath('folder/a.py'), 'folder');
  assert.equal(parentJupyterPath('a.py'), '');
});

void test('rejects path traversal segments', () => {
  assert.throws(() => normalizeJupyterPath('../secret'), /cannot contain/);
  assert.throws(() => normalizeJupyterPath('folder/./file'), /cannot contain/);
});

void test('extracts tokens without keeping them in the persisted URL', () => {
  const parsed = parseServerUrl('https://example.test/user/alice?token=secret#fragment');
  assert.deepEqual(parsed, {
    baseUrl: 'https://example.test/user/alice/',
    token: 'secret'
  });
});

void test('accepts full Jupyter UI URLs and strips pasted trailing punctuation', () => {
  const parsed = parseServerUrl('http://127.0.0.1:8888/tree?token=abcdef123456,');
  assert.deepEqual(parsed, {
    baseUrl: 'http://127.0.0.1:8888/',
    token: 'abcdef123456'
  });
});

void test('preserves a deployment base path while removing Jupyter UI routes', () => {
  assert.equal(
    parseServerUrl('https://example.test/user/alice/lab/tree').baseUrl,
    'https://example.test/user/alice/'
  );
});

void test('accepts only HTTP Jupyter server URLs', () => {
  assert.throws(() => parseServerUrl('ssh://example.test'), /http:\/\//);
});
