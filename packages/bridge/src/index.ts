#!/usr/bin/env node
/**
 * Universal Router Manager — Local Bridge entry point.
 *
 *   npm run dev:bridge            # simulated router (safe, no network access)
 *   npm run dev:bridge -- --real  # talk to the real router on your LAN
 *
 * Environment:
 *   PORT=8787            server port
 *   URLM_BIND=0.0.0.0    bind address
 *   URLM_ALLOW_REMOTE=1  allow non-loopback clients (hosted demo only)
 *   URLM_TOKEN=...       shared secret for remote clients
 *   URLM_LOG_LEVEL=info  trace | debug | info | warn | error
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 * محمد إبراهيم أبو العز
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_META, createLogger, Logger } from '@urlm/core';
import { EngineHost } from './engine-host.ts';
import { BridgeServer } from './server.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const realMode = argv.includes('--real');
  const noPersist = argv.includes('--no-persist');
  const profileArg = argv.find((arg) => arg.startsWith('--profile='))?.split('=')[1];

  Logger.configure({
    level: (process.env.URLM_LOG_LEVEL as never) ?? 'info',
    // The bridge is a CLI: logs belong on stdout (already redacted by Logger).
    sink: (entry) => {
      const stamp = new Date(entry.at).toISOString().slice(11, 19);
      const line = `${stamp} ${entry.level.toUpperCase().padEnd(5)} ${entry.scope}: ${entry.message}`;
      if (entry.data === undefined) console.log(line);
      else console.log(line, JSON.stringify(entry.data));
    },
  });
  const log = createLogger('bridge');

  log.info(`${APP_META.name} — Local Bridge v${APP_META.version}`, {
    developer: APP_META.developer.en,
    copyright: APP_META.copyright,
    mode: realMode ? 'real' : 'simulated',
  });

  const host = new EngineHost({ persist: !noPersist });
  if (!realMode) {
    await host.setMode('simulated', profileArg ?? 'huawei-hg8145');
  } else {
    await host.setMode('real');
  }

  const webRoot = path.resolve(here, '../../web/dist');
  const server = new BridgeServer({
    host,
    port: Number(process.env.PORT ?? 8787),
    bind: process.env.URLM_BIND ?? '0.0.0.0',
    webRoot,
    token: process.env.URLM_TOKEN,
    allowRemote: process.env.URLM_ALLOW_REMOTE === '1',
  });

  const { port, bind } = await server.listen();
  host.setSelfUrl(`http://127.0.0.1:${port}`);
  log.info('ready', {
    url: `http://${bind === '0.0.0.0' ? 'localhost' : bind}:${port}`,
    mode: realMode ? 'real router' : 'simulated router',
    safety:
      'The bridge only ever contacts private/LAN addresses, never performs authentication bypass, and never sends your data anywhere.',
  });

  const shutdown = async (signal: string) => {
    log.info('shutting down', { signal });
    await server.close();
    await host.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Local Bridge failed to start:', error);
  process.exit(1);
});
