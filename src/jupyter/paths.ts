import { posix } from 'node:path';

export interface ParsedServerUrl {
  readonly baseUrl: string;
  readonly token?: string;
}

export function normalizeJupyterPath(value: string): string {
  const segments = value
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment.length > 0);

  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Jupyter paths cannot contain . or .. segments.');
  }

  return segments.join('/');
}

export function encodeJupyterPath(value: string): string {
  return normalizeJupyterPath(value)
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function parentJupyterPath(value: string): string {
  const normalized = normalizeJupyterPath(value);
  if (!normalized) {
    return '';
  }

  const parent = posix.dirname(normalized);
  return parent === '.' ? '' : parent;
}

export function parseServerUrl(value: string): ParsedServerUrl {
  const trimmedValue = value.trim();
  const parsed = new URL(trimmedValue.endsWith(',') ? trimmedValue.slice(0, -1) : trimmedValue);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('The server URL must use http:// or https://.');
  }

  const tokenValue = parsed.searchParams.get('token');
  const token = tokenValue ? normalizeJupyterToken(tokenValue) : undefined;
  parsed.username = '';
  parsed.password = '';
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = inferJupyterBasePath(parsed.pathname);
  if (!parsed.pathname.endsWith('/')) {
    parsed.pathname += '/';
  }

  return { baseUrl: parsed.toString(), token };
}

export function normalizeJupyterToken(value: string): string {
  const token = value.trim();
  return /^[a-f\d]+,$/i.test(token) ? token.slice(0, -1) : token;
}

function inferJupyterBasePath(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  const applicationRouteIndex = segments.findIndex((segment) =>
    segment === 'tree' || segment === 'lab' || segment === 'notebooks'
  );
  const baseSegments = applicationRouteIndex < 0
    ? segments
    : segments.slice(0, applicationRouteIndex);
  return `/${baseSegments.join('/')}${baseSegments.length > 0 ? '/' : ''}`;
}
