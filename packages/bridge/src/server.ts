/**
 * Local Bridge HTTP server.
 *
 * Security model:
 *  - binds to 0.0.0.0 so it also works inside containers/sandboxes, but
 *    REJECTS requests that are not from the loopback interface unless
 *    URLM_ALLOW_REMOTE=1 (used by the hosted demo, which only ever drives a
 *    simulated router) or a matching URLM_TOKEN header is supplied;
 *  - no credentials are ever logged; the log ring buffer is redacted upstream;
 *  - every mutating endpoint is explicit and returns a verified result.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { RouterError, createLogger, routeBridgeRequest, toRouterError } from '@urlm/core';
import { EngineHost } from './engine-host.ts';
import { createPayloadStream, drainThrottled } from './speedtest.ts';

const log = createLogger('bridge.server');

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
} as const;

/**
 * Origins the native Android shell (and any local web origin) may call from.
 * Deliberately limited to loopback/capacitor origins: the bridge never becomes
 * a cross-site API for the open internet.
 */
const LOCAL_ORIGIN = /^(https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?|capacitor:\/\/localhost|https?:\/\/localhost)$/;

export interface ServerOptions {
  host: EngineHost;
  port?: number;
  bind?: string;
  /** Directory of the built web app, served when present. */
  webRoot?: string;
  token?: string;
  allowRemote?: boolean;
}

interface SseClient {
  id: number;
  write: (event: string, data: unknown) => void;
  close: () => void;
}

export class BridgeServer {
  private server: http.Server;
  private clients = new Set<SseClient>();
  private nextClientId = 1;
  private host: EngineHost;
  private token?: string;
  private allowRemote: boolean;
  private webRoot?: string;

  constructor(private readonly options: ServerOptions) {
    this.host = options.host;
    this.token = options.token;
    this.allowRemote = options.allowRemote ?? process.env.URLM_ALLOW_REMOTE === '1';
    this.webRoot = options.webRoot;
    this.server = http.createServer((request, response) => {
      void this.handle(request, response);
    });
    this.host.on((event, payload) => this.broadcast(event, payload));
  }

  listen(): Promise<{ port: number; bind: string }> {
    const port = this.options.port ?? Number(process.env.PORT ?? 8787);
    const bind = this.options.bind ?? '0.0.0.0';
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, bind, () => {
        const address = this.server.address();
        const actualPort = typeof address === 'object' && address ? address.port : port;
        log.info('local bridge listening', { port: actualPort, bind, allowRemote: this.allowRemote });
        resolve({ port: actualPort, bind });
      });
    });
  }

  async close(): Promise<void> {
    for (const client of this.clients) client.close();
    this.clients.clear();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /* ------------------------------------------------------------------ *
   * Routing
   * ------------------------------------------------------------------ */

  private async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;

    try {
      if (pathname === '/api/stream') {
        if (!this.authorise(request, response)) return;
        this.openStream(request, response);
        return;
      }

      if (pathname.startsWith('/api/')) {
        if (!this.authorise(request, response)) return;
        // The download/upload payloads are intentionally unauthenticated to the
        // loopback boundary check above but stream binary data.
        if (pathname === '/api/speedtest/payload') {
          const bytes = Number(url.searchParams.get('bytes') ?? 1_000_000);
          // In demo mode the virtual line is shaped to the profile's plan, so a
          // browser-side measurement still measures a real (shaped) transfer.
          const requested = Number(url.searchParams.get('bps') ?? 0);
          const bps = requested > 0 ? requested : this.host.speedPlan().bytesPerSecond || undefined;
          response.writeHead(200, {
            'content-type': 'application/octet-stream',
            'cache-control': 'no-store',
            'content-length': String(Math.max(1, Math.min(bytes, 64 * 1024 * 1024))),
          });
          createPayloadStream(bytes, bps).pipe(response);
          return;
        }
        if (pathname === '/api/speedtest/upload') {
          const requested = Number(url.searchParams.get('bps') ?? 0);
          const plan = this.host.speedPlan();
          const bps = requested > 0 ? requested : Math.round(plan.uploadMbps * 125_000) || undefined;
          await drainThrottled(request, bps);
          response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
          response.end(JSON.stringify({ ok: true }));
          return;
        }
        await this.handleApi(request, response, pathname, url);
        return;
      }

      await this.serveStatic(response, pathname);
    } catch (error) {
      const routerError = toRouterError(error);
      log.warn('request failed', { path: pathname, code: routerError.code });
      sendJson(response, routerError.status && routerError.status >= 400 ? routerError.status : 500, {
        ok: false,
        error: {
          code: routerError.code,
          message: routerError.userMessage,
          hint: routerError.userHint,
          technical: routerError.technicalMessage,
        },
      });
    }
  }

  private async handleApi(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    pathname: string,
    url: URL,
  ): Promise<void> {
    const method = (request.method ?? 'GET').toUpperCase();
    const raw = method === 'POST' || method === 'PUT' ? await readJsonBody(request) : {};
    const result = await routeBridgeRequest(this.host, {
      method,
      pathname,
      query: url.searchParams,
      body: raw as Record<string, unknown>,
    });

    if (result.type === 'stream') {
      response.writeHead(200, SSE_HEADERS);
      const sink = {
        send: (event: string, payload: unknown) => {
          response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
        },
      };
      await result.run(sink);
      response.end();
      return;
    }
    return sendJson(response, result.status, result.body, result.headers);
  }

  /* ------------------------------------------------------------------ *
   * SSE
   * ------------------------------------------------------------------ */

  private openStream(request: http.IncomingMessage, response: http.ServerResponse): void {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    response.write(': connected\n\n');

    const client: SseClient = {
      id: this.nextClientId++,
      write: (event, data) => {
        response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      },
      close: () => response.end(),
    };
    this.clients.add(client);
    client.write('state', { state: this.host.stateSnapshot(), describe: this.host.describe() });

    const keepAlive = setInterval(() => response.write(': ping\n\n'), 20_000);
    request.on('close', () => {
      clearInterval(keepAlive);
      this.clients.delete(client);
    });
  }

  private broadcast(event: string, payload: unknown): void {
    for (const client of this.clients) {
      try {
        client.write(event, payload);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Static + auth
   * ------------------------------------------------------------------ */

  private async serveStatic(response: http.ServerResponse, pathname: string): Promise<void> {
    if (!this.webRoot) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(
        `<html><head><title>Universal Router Manager — Local Bridge</title></head><body style="font-family:system-ui;background:#05070f;color:#e6edff;padding:40px">
        <h1>Universal Router Manager</h1>
        <p>Local Bridge is running. The web interface is served by the Vite dev server (<code>npm run dev:web</code>) or from <code>packages/web/dist</code>.</p>
        <p>API health: <a style="color:#6ee7ff" href="/api/health">/api/health</a></p>
        <p style="opacity:.6">© 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.</p>
        </body></html>`,
      );
      return;
    }

    const safePath = pathname === '/' ? '/index.html' : pathname;
    const target = path.join(this.webRoot, path.normalize(safePath).replace(/^([/\\])+/, ''));
    if (!target.startsWith(this.webRoot)) {
      response.writeHead(403).end('forbidden');
      return;
    }
    try {
      const info = await stat(target);
      if (!info.isFile()) throw new Error('not a file');
      const data = await readFile(target);
      response.writeHead(200, { 'content-type': contentType(target), 'cache-control': 'no-cache' });
      response.end(data);
    } catch {
      // SPA fallback
      try {
        const index = await readFile(path.join(this.webRoot, 'index.html'));
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(index);
      } catch {
        response.writeHead(404).end('not found');
      }
    }
  }

  private authorise(request: http.IncomingMessage, response: http.ServerResponse): boolean {
    const remote = request.socket.remoteAddress ?? '';
    const loopback =
      remote === '127.0.0.1' ||
      remote === '::1' ||
      remote === '::ffff:127.0.0.1' ||
      remote.startsWith('127.') ||
      remote === '';
    if (loopback) return true;

    if (this.token) {
      const provided = request.headers['x-urlm-token'];
      if (typeof provided === 'string' && provided === this.token) return true;
    }

    if (this.allowRemote) {
      log.warn('remote access allowed explicitly', { remote });
      return true;
    }

    log.warn('rejected non-local request', { remote, url: request.url });
    sendJson(response, 403, {
      ok: false,
      error: {
        code: 'bridge-forbidden',
        message: 'الجسر المحلي يرفض الطلبات من خارج هذا الجهاز.',
        hint: 'شغّل التطبيق من نفس الجهاز، أو اضبط URLM_TOKEN / URLM_ALLOW_REMOTE.',
      },
    });
    return false;
  }
}

/* ------------------------------------------------------------------ */

function sendJson(
  response: http.ServerResponse,
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    ...headers,
  });
  response.end(body);
}

async function readJsonBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.byteLength;
    if (size > 2 * 1024 * 1024) throw new RouterError('invalid-params', { detail: 'request body too large' });
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new RouterError('invalid-params', { detail: 'body must be JSON' });
  }
}

function contentType(file: string): string {
  const extension = path.extname(file).toLowerCase();
  switch (extension) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}
