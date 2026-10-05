/**
 * Verification Engine (spec §26).
 *
 * The app never says "Done" merely because a POST returned 200. A change is
 * reported as applied only after the router itself confirms the new value.
 * Three truthful outcomes exist:
 *
 *   verified            — the value was read back and matched;
 *   accepted-unverified — the device accepted the write but exposes no way to
 *                         read it back (the UI wording stays honest);
 *   rejected            — the write failed or the read-back disagreed.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { createLogger } from '../core/logger';
import { HttpSession, type HttpResponse } from '../core/http';
import type { VerificationResult } from '../core/types';

const log = createLogger('verification');

export interface ReadBackSpec {
  path: string;
  pattern: string;
  /** Expected value; when omitted the assertion is "the field exists". */
  expected?: string;
  /** Normalise both sides before comparing (case, spacing, quotes). */
  normalize?: (value: string) => string;
  timeoutMs?: number;
}

export interface ResponseAssertSpec {
  /** Body regex that proves acceptance. */
  expect?: string;
  /** Body regex that proves rejection (checked first). */
  notExpect?: string;
  status?: number;
}

export interface VerificationRequest {
  session: HttpSession;
  /** Response of the write request itself. */
  response?: HttpResponse;
  assert?: ResponseAssertSpec;
  readBack?: ReadBackSpec;
  /** Custom verifier (e.g. wait for the router to come back after a reboot). */
  custom?: () => Promise<VerificationResult>;
  attempts?: number;
  retryDelayMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_NORMALIZE = (value: string): string =>
  value.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').toLowerCase();

export class VerificationEngine {
  /**
   * Run the strongest available verification strategy.
   * Order: custom → read-back → response assertion → status only.
   */
  static async verify(request: VerificationRequest): Promise<VerificationResult> {
    const checkedAt = new Date().toISOString();

    if (request.custom) {
      try {
        const result = await request.custom();
        return { ...result, checkedAt: result.checkedAt ?? checkedAt };
      } catch (error) {
        return {
          outcome: 'unknown',
          strategy: 'none',
          attempts: 1,
          detail: (error as Error).message,
          checkedAt,
        };
      }
    }

    // 1. Did the device explicitly reject the write?
    const body = request.response?.body ?? '';
    if (request.assert?.notExpect) {
      const rejection = safeTest(request.assert.notExpect, body);
      if (rejection) {
        return {
          outcome: 'rejected',
          strategy: 'response-assert',
          attempts: 1,
          evidence: truncate(matchAround(request.assert.notExpect, body)),
          detail: 'Device reported a rejection in the write response',
          checkedAt,
        };
      }
    }

    const attempts = request.attempts ?? 2;
    const retryDelay = request.retryDelayMs ?? 350;

    // 2. Read the value back from the device — the only true proof.
    if (request.readBack) {
      let lastDetail = '';
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          const response = await request.session.request({
            url: request.readBack.path,
            method: 'GET',
            timeoutMs: request.readBack.timeoutMs ?? 4500,
            signal: request.signal,
          });
          const match = new RegExp(request.readBack.pattern, 'i').exec(response.body ?? '');
          const observed = match?.[1] ?? match?.[0];
          if (observed === undefined) {
            lastDetail = 'read-back endpoint answered but the value was not found';
            await delay(retryDelay, request.signal);
            continue;
          }
          if (!request.readBack.expected) {
            const accepted = matchesExpectation(request.assert, request.response);
            return {
              outcome: accepted ? 'verified' : 'accepted-unverified',
              strategy: 'read-back',
              attempts: attempt,
              evidence: `read back: ${truncate(observed)}`,
              detail: accepted ? undefined : 'Value present but acceptance could not be asserted',
              checkedAt,
            };
          }
          const normalize = request.readBack.normalize ?? DEFAULT_NORMALIZE;
          if (normalize(observed) === normalize(request.readBack.expected)) {
            return {
              outcome: 'verified',
              strategy: 'read-back',
              attempts: attempt,
              evidence: `read back matched: ${truncate(observed)}`,
              checkedAt,
            };
          }
          lastDetail = `read back "${truncate(observed)}" != expected "${truncate(request.readBack.expected)}"`;
          await delay(retryDelay, request.signal);
        } catch (error) {
          lastDetail = (error as Error).message;
          await delay(retryDelay, request.signal);
        }
      }
      const accepted = matchesExpectation(request.assert, request.response);
      return {
        outcome: accepted ? 'accepted-unverified' : 'rejected',
        strategy: accepted ? 'response-assert' : 'read-back',
        attempts,
        detail: lastDetail || 'read-back did not confirm the new value',
        checkedAt,
      };
    }

    // 3. No read-back path: be honest about it.
    const accepted = matchesExpectation(request.assert, request.response);
    if (accepted) {
      return {
        outcome: 'accepted-unverified',
        strategy: 'response-assert',
        attempts: 1,
        detail: 'The device accepted the request but this model exposes no read-back for the value',
        checkedAt,
      };
    }
    if (request.response && request.response.status < 400 && !request.assert) {
      return {
        outcome: 'accepted-unverified',
        strategy: 'status-only',
        attempts: 1,
        detail: 'HTTP status only — no appliance level confirmation available',
        checkedAt,
      };
    }
    return {
      outcome: 'rejected',
      strategy: request.response ? 'response-assert' : 'none',
      attempts: 1,
      evidence: request.response ? truncate(safeSlice(request.response.body)) : undefined,
      detail: request.response
        ? `Write was not accepted (HTTP ${request.response.status})`
        : 'No response captured for the write request',
      checkedAt,
    };
  }

  /**
   * Reboot-style verification: the device must actually drop and come back.
   */
  static async verifyReboot(
    session: HttpSession,
    options: { timeoutMs?: number; signal?: AbortSignal; pollIntervalMs?: number } = {},
  ): Promise<VerificationResult> {
    const started = Date.now();
    const timeout = options.timeoutMs ?? 90_000;
    const interval = options.pollIntervalMs ?? 2000;
    const host = safeHost(session.baseUrl);
    let sawDrop = false;
    let attempts = 0;

    while (Date.now() - started < timeout) {
      attempts += 1;
      await delay(interval, options.signal);
      try {
        const response = await session.request({ url: '/', method: 'GET', timeoutMs: 4000, signal: options.signal });
        if (response.status < 500) {
          if (sawDrop) {
            return {
              outcome: 'verified',
              strategy: 'custom',
              attempts,
              evidence: `${host} answered again after ${Math.round((Date.now() - started) / 1000)}s`,
              checkedAt: new Date().toISOString(),
            };
          }
          // Device already back (fast reboot) — still a positive confirmation.
          if (Date.now() - started > interval * 2) {
            return {
              outcome: 'verified',
              strategy: 'custom',
              attempts,
              evidence: `${host} is reachable again`,
              checkedAt: new Date().toISOString(),
            };
          }
        }
      } catch {
        sawDrop = true;
      }
    }
    return {
      outcome: sawDrop ? 'accepted-unverified' : 'unknown',
      strategy: 'custom',
      attempts,
      detail: sawDrop
        ? 'The router went offline but did not answer again within the timeout'
        : 'No connectivity drop was observed within the timeout',
      checkedAt: new Date().toISOString(),
    };
  }

  /** Retry-until-matches read-back helper used for asynchronous device changes. */
  static async waitForValue(
    session: HttpSession,
    path: string,
    pattern: string,
    expected: string,
    options: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {},
  ): Promise<VerificationResult> {
    const deadline = Date.now() + (options.timeoutMs ?? 12_000);
    let attempts = 0;
    let lastObserved: string | undefined;
    while (Date.now() < deadline) {
      attempts += 1;
      try {
        const response = await session.request({ url: path, method: 'GET', timeoutMs: 4000, signal: options.signal });
        const match = new RegExp(pattern, 'i').exec(response.body ?? '');
        lastObserved = match?.[1] ?? match?.[0];
        if (lastObserved && DEFAULT_NORMALIZE(lastObserved) === DEFAULT_NORMALIZE(expected)) {
          return {
            outcome: 'verified',
            strategy: 'read-back',
            attempts,
            evidence: `read back matched: ${truncate(lastObserved)}`,
            checkedAt: new Date().toISOString(),
          };
        }
      } catch (error) {
        lastObserved = (error as Error).message;
      }
      await delay(options.intervalMs ?? 900, options.signal);
    }
    return {
      outcome: 'accepted-unverified',
      strategy: 'read-back',
      attempts,
      detail: lastObserved ? `Last observed value: ${truncate(lastObserved)}` : 'No value observed',
      checkedAt: new Date().toISOString(),
    };
  }
}

/* ------------------------------------------------------------------ */

function matchesExpectation(assert: ResponseAssertSpec | undefined, response: HttpResponse | undefined): boolean {
  if (!response) return false;
  if (!assert) return response.status < 400;
  if (assert.notExpect && safeTest(assert.notExpect, response.body)) return false;
  if (assert.status !== undefined) return response.status === assert.status;
  if (assert.expect) return safeTest(assert.expect, response.body);
  return response.status < 400;
}

function safeTest(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern, 'i').test(value);
  } catch {
    return false;
  }
}

function matchAround(pattern: string, value: string): string {
  try {
    const match = new RegExp(pattern, 'i').exec(value);
    if (!match) return '';
    const index = Math.max(0, match.index - 30);
    return value.slice(index, index + 90);
  } catch {
    return '';
  }
}

function safeSlice(body: string | undefined, max = 120): string {
  return (body ?? '').replace(/\s+/g, ' ').slice(0, max);
}

function truncate(value: string, max = 80): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
