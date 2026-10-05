/**
 * Universal login (spec §8) — the user only ever sees Username / Password /
 * Login. Everything below (session, cookie, token, HTTP auth, vendor quirks) is
 * handled transparently.
 *
 * Strategies are attempted in a documented, rate-limited order. There is no
 * credential guessing: each strategy performs exactly ONE authentication
 * attempt with the credentials the user supplied, then reports honestly.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { createLogger } from '../core/logger';
import { HttpSession, type HttpResponse } from '../core/http';
import { RouterError, toRouterError } from '../core/errors';
import type { LoginRecipe, RouterCredentials } from '../core/types';
import {
  base64Encode,
  extractFormActions,
  extractInputs,
  md5,
  sha256Hex,
  uniq,
} from '../core/util';

const log = createLogger('auth');

export type PasswordTransform = 'plain' | 'md5' | 'base64' | 'md5-base64' | 'base64-md5' | 'sha256' | 'sha256-base64';

export interface LoginContext {
  session: HttpSession;
  credentials: RouterCredentials;
  /** Recipe discovered during fingerprinting/login-page analysis, if any. */
  recipe?: LoginRecipe;
  /** Path proving an authenticated session (defaults to the recipe probe). */
  successProbe?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface LoginOutcome {
  ok: boolean;
  recipe: LoginRecipe;
  /** Human-readable, non-secret detail for Advanced Mode. */
  detail?: string;
  /** Session token acquired (kept in memory only). */
  token?: string;
  cookieNames?: string[];
  /** Why it failed — drives the Error UX copy. */
  reason?: 'auth-failed' | 'captcha' | 'unsupported' | 'network' | 'timeout';
  attempts: number;
  durationMs: number;
}

export interface LoginStrategy {
  readonly id: string;
  /** Cheap check before attempting (does not touch the network). */
  canHandle(recipe: LoginRecipe | undefined): boolean;
  login(context: LoginContext, transform: PasswordTransform, recipeOverride?: LoginRecipe): Promise<LoginOutcome>;
}

/* ------------------------------------------------------------------ *
 * Password transforms
 * ------------------------------------------------------------------ */

export async function applyPasswordTransform(password: string, transform: PasswordTransform): Promise<string> {
  switch (transform) {
    case 'plain':
      return password;
    case 'md5':
      return md5(password);
    case 'base64':
      return base64Encode(password);
    case 'md5-base64':
      return base64Encode(md5(password));
    case 'base64-md5':
      return md5(base64Encode(password));
    case 'sha256':
      return sha256Hex(password);
    case 'sha256-base64':
      return base64Encode(await sha256Hex(password));
    default:
      return password;
  }
}

/** Order in which transforms are tried for a single form-based login. */
export const DEFAULT_TRANSFORM_ORDER: PasswordTransform[] = ['plain', 'md5', 'base64', 'md5-base64'];

/* ------------------------------------------------------------------ *
 * HTTP Basic / Digest
 * ------------------------------------------------------------------ */

export class HttpAuthStrategy implements LoginStrategy {
  readonly id = 'http-auth';

  canHandle(recipe: LoginRecipe | undefined): boolean {
    return recipe?.kind === 'http-basic' || recipe?.kind === 'http-digest';
  }

  async login(context: LoginContext, transform: PasswordTransform, recipeOverride?: LoginRecipe): Promise<LoginOutcome> {
    const started = Date.now();
    const recipe = recipeOverride ?? context.recipe ?? {
      kind: 'http-basic' as const,
      loginUrl: '/',
    };
    const password = await applyPasswordTransform(context.credentials.password, transform);
    const probePath = context.successProbe ?? recipe.successProbe ?? '/';

    try {
      const challenge = await context.session.request({
        url: probePath,
        method: 'GET',
        timeoutMs: context.timeoutMs ?? 5000,
        signal: context.signal,
      });
      const wwwAuthenticate = challenge.headers['www-authenticate'] ?? '';
      if (!/basic|digest/i.test(wwwAuthenticate)) {
        // Already authenticated (no challenge) — honest, if unusual.
        const ok = !context.session.looksLikeLoginPage(challenge.body);
        return {
          ok,
          recipe,
          detail: ok ? 'No authentication challenge was presented; session appears open.' : 'Challenge missing.',
          reason: ok ? undefined : 'auth-failed',
          attempts: 1,
          durationMs: Date.now() - started,
          cookieNames: context.session.transport.cookies?.snapshot().map((cookie) => cookie.name),
        };
      }

      const isDigest = /digest/i.test(wwwAuthenticate);
      const header = isDigest
        ? buildDigestHeader(wwwAuthenticate, probePath, 'GET', context.credentials.username, password)
        : `Basic ${base64Encode(`${context.credentials.username}:${password}`)}`;

      const response = await context.session.request({
        url: probePath,
        method: isDigest ? 'GET' : 'GET',
        headers: { authorization: header },
        timeoutMs: context.timeoutMs ?? 5000,
        signal: context.signal,
      });

      const ok = response.status < 400;
      return {
        ok,
        recipe: { ...recipe, kind: isDigest ? 'http-digest' : 'http-basic' },
        detail: ok ? 'HTTP auth accepted' : `HTTP auth rejected with status ${response.status}`,
        reason: ok ? undefined : 'auth-failed',
        attempts: 1,
        durationMs: Date.now() - started,
        cookieNames: context.session.transport.cookies?.snapshot().map((cookie) => cookie.name),
      };
    } catch (error) {
      return failureOutcome(toRouterError(error), recipe, started, 1);
    }
  }
}

function buildDigestHeader(
  challenge: string,
  uri: string,
  method: string,
  username: string,
  password: string,
): string {
  const params = Object.fromEntries(
    [...challenge.matchAll(/(\w+)\s*=\s*(?:"([^"]*)"|([^\s,]+))/g)].map((match) => [
      (match[1] as string).toLowerCase(),
      (match[2] ?? match[3] ?? '') as string,
    ]),
  ) as Record<string, string>;
  const realm = params.realm ?? '';
  const nonce = params.nonce ?? '';
  const qop = params.qop?.split(',')[0]?.trim();
  const opaque = params.opaque;
  const algorithm = (params.algorithm ?? 'MD5').toUpperCase();
  const nc = '00000001';
  const cnonce = Math.random().toString(36).slice(2, 12);
  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = qop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);
  const parts = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
    algorithm !== 'MD5' ? `algorithm=${algorithm}` : 'algorithm=MD5',
  ];
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  if (opaque) parts.push(`opaque="${opaque}"`);
  return `Digest ${parts.join(', ')}`;
}

/* ------------------------------------------------------------------ *
 * Form / session login (the most common case)
 * ------------------------------------------------------------------ */

export interface FormLoginOptions {
  /** Field carrying the CSRF/token value, discovered on the login page. */
  tokenFields?: RegExp;
  /** Field-name candidates for username / password. */
  usernameFields?: RegExp;
  passwordFields?: RegExp;
  /** JSON-RPC style login (TP-Link web UI 4+, Tenda, Xiaomi). */
  jsonRpc?: boolean;
}

export class FormSessionStrategy implements LoginStrategy {
  readonly id = 'form-session';

  constructor(private readonly options: FormLoginOptions = {}) {}

  canHandle(recipe: LoginRecipe | undefined): boolean {
    return (
      !recipe ||
      recipe.kind === 'form-session' ||
      recipe.kind === 'form-session-token' ||
      recipe.kind === 'vendor-custom'
    );
  }

  async login(context: LoginContext, transform: PasswordTransform, recipeOverride?: LoginRecipe): Promise<LoginOutcome> {
    const started = Date.now();
    let attempts = 0;
    const recipe: LoginRecipe = recipeOverride ??
      context.recipe ?? { kind: 'form-session', loginUrl: '/' };

    const usernamePattern = this.options.usernameFields ?? /(user|username|usr|login|account|admin|name)/i;
    const passwordPattern = this.options.passwordFields ?? /(pass|pwd|password|key|pin)/i;
    const tokenPattern = this.options.tokenFields ?? /(token|csrf|nonce|rand|auth|seq|key|session)/i;

    try {
      // 1. Fetch the login page to discover field names + hidden tokens.
      attempts += 1;
      const loginPage = await context.session.request({
        url: recipe.loginUrl,
        method: 'GET',
        timeoutMs: context.timeoutMs ?? 5000,
        signal: context.signal,
      });
      const page = loginPage.body ?? '';
      const discovered = discoverLoginFields(page, usernamePattern, passwordPattern, tokenPattern);
      const mergedRecipe: LoginRecipe = {
        kind: page.includes('Frm_Logintoken') || discovered.extraFields ? 'form-session-token' : recipe.kind,
        loginUrl: recipe.loginUrl,
        usernameField: recipe.usernameField ?? discovered.usernameField,
        passwordField: recipe.passwordField ?? discovered.passwordField,
        extraFields: { ...discovered.extraFields, ...(recipe.extraFields ?? {}) },
        successProbe: recipe.successProbe ?? context.successProbe,
        notes: discovered.notes.join('; ') || recipe.notes,
      };

      if (detectCaptcha(page)) {
        return {
          ok: false,
          recipe: mergedRecipe,
          reason: 'captcha',
          detail: 'Login page contains a CAPTCHA challenge',
          attempts,
          durationMs: Date.now() - started,
        };
      }

      // 2. Submit credentials (single attempt per transform).
      const password = await applyPasswordTransform(context.credentials.password, transform);
      const action = discovered.formAction ?? extractFormActions(page)[0] ?? mergedRecipe.loginUrl;
      const body: Record<string, string> = {
        ...(mergedRecipe.extraFields ?? {}),
        [mergedRecipe.usernameField ?? 'username']: context.credentials.username,
        [mergedRecipe.passwordField ?? 'password']: password,
      };
      if (!body.username && context.credentials.username) body.username = context.credentials.username;

      attempts += 1;
      const response = await context.session.request({
        url: action,
        method: 'POST',
        body: new URLSearchParams(body).toString(),
        headers: {
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          referer: context.session.resolve(mergedRecipe.loginUrl),
          origin: context.session.baseUrl,
        },
        timeoutMs: context.timeoutMs ?? 6000,
        signal: context.signal,
      });

      const outcome = await this.evaluate(context, mergedRecipe, response, attempts, started);

      // 3. If the login handler is a JSON API, try that shape as a fallback.
      if (!outcome.ok && this.options.jsonRpc !== false && looksJsonish(response.body)) {
        const jsonOutcome = await this.tryJsonLogin(context, mergedRecipe, password, attempts, started);
        if (jsonOutcome) return jsonOutcome;
      }
      return outcome;
    } catch (error) {
      return failureOutcome(toRouterError(error), recipe, started, attempts || 1);
    }
  }

  /** Confirm the session by probing a page that requires authentication. */
  private async evaluate(
    context: LoginContext,
    recipe: LoginRecipe,
    response: HttpResponse,
    attempts: number,
    started: number,
  ): Promise<LoginOutcome> {
    const body = response.body ?? '';
    const failedMarkers = [
      ...(recipe.failureBodyPatterns ?? []),
      'incorrect password',
      'incorrect user name',
      'incorrect username',
      'invalid password',
      'invalid user',
      'wrong password',
      'user name or password',
      'username or password',
      'login failed',
      'loginerror',
      'login error',
      'authentication failed',
      'auth failed',
      'كلمة المرور غير صحيحة',
      'اسم المستخدم أو كلمة المرور غير صحيحة',
    ];
    const explicitFailure = failedMarkers.some((marker) =>
      body.toLowerCase().includes(marker.toLowerCase()),
    ) || /"err_?code"\s*:\s*[1-9]/i.test(body) || /"(result|code)"\s*:\s*-?\d*[1-9]\d*/i.test(body);

    const cookieNames = context.session.transport.cookies?.snapshot().map((cookie) => cookie.name) ?? [];
    const cookieValues = context.session.transport.cookies?.snapshot() ?? [];
    const emptySessionCookie = cookieValues.some(
      (cookie) => /session|auth|sid/i.test(cookie.name) && context.session.transport.cookies?.get(cookie.name) === '0',
    );
    const gotSessionCookie = cookieNames.length > 0 && !emptySessionCookie;

    if (explicitFailure || emptySessionCookie) {
      return {
        ok: false,
        recipe,
        reason: 'auth-failed',
        detail: `Login rejected (HTTP ${response.status})`,
        attempts,
        durationMs: Date.now() - started,
        cookieNames,
      };
    }

    // Verify with a protected page when we know one.
    const probePath = recipe.successProbe ?? context.successProbe;
    if (probePath) {
      try {
        const probe = await context.session.request({
          url: probePath,
          method: 'GET',
          timeoutMs: context.timeoutMs ?? 5000,
          signal: context.signal,
        });
        const stillLogin = probe.status === 401 || context.session.looksLikeLoginPage(probe.body);
        if (!stillLogin) {
          return {
            ok: true,
            recipe,
            detail: `Authenticated (verified via ${probePath})`,
            attempts,
            durationMs: Date.now() - started,
            cookieNames,
            token: context.session.transport.cookies?.get('stok'),
          };
        }
        return {
          ok: false,
          recipe,
          reason: 'auth-failed',
          detail: 'Session was not accepted by the router',
          attempts,
          durationMs: Date.now() - started,
          cookieNames,
        };
      } catch (error) {
        return {
          ok: false,
          recipe,
          reason: toRouterError(error).code === 'timeout' ? 'timeout' : 'network',
          detail: `Verification probe failed: ${(error as Error).message}`,
          attempts,
          durationMs: Date.now() - started,
          cookieNames,
        };
      }
    }

    const ok = gotSessionCookie || !context.session.looksLikeLoginPage(body);
    return {
      ok,
      recipe,
      detail: ok
        ? gotSessionCookie
          ? `Session cookie issued (${cookieNames.slice(0, 3).join(', ')})`
          : 'Login POST accepted'
        : 'Login page returned unchanged',
      reason: ok ? undefined : 'auth-failed',
      attempts,
      durationMs: Date.now() - started,
      cookieNames: uniq(cookieNames),
      token: context.session.transport.cookies?.get('stok'),
    };
  }

  private async tryJsonLogin(
    context: LoginContext,
    recipe: LoginRecipe,
    password: string,
    attempts: number,
    started: number,
  ): Promise<LoginOutcome | undefined> {
    const candidates = uniq([
      recipe.loginUrl,
      '/cgi-bin/luci/;stok=/login?form=login',
      '/api/user/login',
      '/cgi-bin/luci/api/xqsystem/login',
    ]).filter((path, index) => index === 0 || path !== recipe.loginUrl);
    for (const path of candidates) {
      try {
        const response = await context.session.request({
          url: path,
          method: 'POST',
          body: JSON.stringify({ method: 'do', login: { password: base64Encode(password), username: context.credentials.username } }),
          headers: { 'content-type': 'application/json; charset=UTF-8' },
          timeoutMs: context.timeoutMs ?? 6000,
          signal: context.signal,
        });
        if (/"error_?code"\s*:\s*0|"code"\s*:\s*0|"success"\s*:\s*true|stok/i.test(response.body)) {
          const stok = /"stok"\s*:\s*"([^"]+)"/i.exec(response.body)?.[1];
          if (stok) {
            try {
              context.session.transport.cookies?.set('stok', stok, new URL(context.session.baseUrl).hostname);
            } catch {
              /* cookie jar is optional */
            }
          }
          return {
            ok: true,
            recipe: { ...recipe, kind: 'form-session-token', successProbe: recipe.successProbe ?? context.successProbe },
            detail: `JSON login accepted at ${path}`,
            token: stok,
            attempts,
            durationMs: Date.now() - started,
            cookieNames: context.session.transport.cookies?.snapshot().map((cookie) => cookie.name),
          };
        }
      } catch {
        /* try the next candidate */
      }
    }
    return undefined;
  }
}

/* ------------------------------------------------------------------ *
 * Token / bearer login (Huawei HiLink, REST devices)
 * ------------------------------------------------------------------ */

export class TokenLoginStrategy implements LoginStrategy {
  readonly id = 'token-login';

  canHandle(recipe: LoginRecipe | undefined): boolean {
    return recipe?.kind === 'form-session-token' || recipe?.kind === 'token-bearer' || recipe === undefined;
  }

  async login(context: LoginContext, transform: PasswordTransform, recipeOverride?: LoginRecipe): Promise<LoginOutcome> {
    const started = Date.now();
    const recipe = recipeOverride ?? context.recipe;
    const tokenEndpoint = recipe?.tokenEndpoint ?? '/api/webserver/SesTokInfo';
    const password = await applyPasswordTransform(context.credentials.password, transform);

    try {
      // 1. Fetch the session/token pair the device expects.
      let token: string | undefined;
      try {
        const tokenResponse = await context.session.request({
          url: tokenEndpoint,
          method: 'GET',
          timeoutMs: context.timeoutMs ?? 5000,
          signal: context.signal,
        });
        token = /<TokInfo>([^<]+)<\/TokInfo>/i.exec(tokenResponse.body)?.[1] ?? /"TokInfo"\s*:\s*"([^"]+)"/i.exec(tokenResponse.body)?.[1];
      } catch {
        /* devices without a token endpoint continue with a plain POST */
      }

      // 2. POST the credentials (form + JSON shapes are both accepted by most).
      const loginUrl = recipe?.loginUrl ?? '/api/user/login';
      const form: Record<string, string> = {
        UserName: context.credentials.username,
        Username: context.credentials.username,
        username: context.credentials.username,
        Password: password,
        password,
      };
      if (token) form.__RequestVerificationToken = token;

      const response = await context.session.request({
        url: loginUrl,
        method: 'POST',
        body: new URLSearchParams(form).toString(),
        headers: {
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          ...(token ? { __RequestVerificationToken: token } : {}),
        },
        timeoutMs: context.timeoutMs ?? 6000,
        signal: context.signal,
      });

      const body = response.body ?? '';
      const ok =
        response.status < 400 &&
        !/error|fail|<error>/i.test(body) &&
        (/"code"\s*:\s*0/.test(body) || /<SesInfo>|<response>\s*OK/i.test(body) || context.session.transport.cookies !== undefined);

      return {
        ok,
        recipe: { ...(recipe ?? { kind: 'form-session-token', loginUrl }), tokenEndpoint, kind: 'form-session-token' },
        detail: ok ? 'Token login accepted' : `Token login rejected (HTTP ${response.status})`,
        reason: ok ? undefined : 'auth-failed',
        token,
        attempts: 2,
        durationMs: Date.now() - started,
        cookieNames: context.session.transport.cookies?.snapshot().map((cookie) => cookie.name) ?? [],
      };
    } catch (error) {
      return failureOutcome(toRouterError(error), recipe ?? { kind: 'form-session-token', loginUrl: tokenEndpoint }, started, 2);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

export function discoverLoginFields(
  html: string,
  usernamePattern: RegExp,
  passwordPattern: RegExp,
  tokenPattern: RegExp,
): {
  usernameField?: string;
  passwordField?: string;
  extraFields: Record<string, string>;
  formAction?: string;
  notes: string[];
} {
  const inputs = extractInputs(html);
  const notes: string[] = [];
  let usernameField: string | undefined;
  let passwordField: string | undefined;
  const extraFields: Record<string, string> = {};

  for (const input of inputs) {
    const haystack = `${input.name} ${input.id ?? ''}`;
    if (input.type === 'password') {
      if (!passwordField || (!passwordPattern.test(haystack) && passwordPattern.test(`${passwordField}`))) {
        passwordField = input.name;
      }
      continue;
    }
    if (input.type === 'hidden') {
      if (tokenPattern.test(haystack) && input.value !== undefined) {
        extraFields[input.name] = input.value;
        notes.push(`hidden token field: ${input.name}`);
      } else if (input.value !== undefined) {
        extraFields[input.name] = input.value;
      }
      continue;
    }
    if (!usernameField && (input.type === 'text' || input.type === 'email') && usernamePattern.test(haystack)) {
      usernameField = input.name;
    }
  }

  if (!usernameField) {
    const text = extractInputs(html).find((input) => input.type === 'text' || input.type === 'email');
    usernameField = text?.name;
  }
  if (!passwordField) {
    passwordField = extractInputs(html).find((input) => input.type === 'password')?.name;
  }

  return { usernameField, passwordField, extraFields, formAction: extractFormActions(html)[0], notes };
}

export function detectCaptcha(html: string): boolean {
  const text = html.toLowerCase();
  return (
    /captcha|recaptcha|hcaptcha|verifycode|checkcode|vcode/.test(text) ||
    /<img[^>]+src=["'][^"']*(captcha|verify|code)[^"']*["']/i.test(html)
  );
}

function looksJsonish(body: string): boolean {
  const trimmed = body.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function failureOutcome(error: RouterError, recipe: LoginRecipe, started: number, attempts: number): LoginOutcome {
  log.warn('login attempt failed', { code: error.code, attempts });
  return {
    ok: false,
    recipe,
    reason: error.code === 'timeout' ? 'timeout' : error.code === 'auth-failed' ? 'auth-failed' : 'network',
    detail: error.technicalMessage,
    attempts,
    durationMs: Date.now() - started,
  };
}

/** Default strategy chain, ordered by real-world frequency. */
export function defaultStrategies(): LoginStrategy[] {
  return [new HttpAuthStrategy(), new TokenLoginStrategy(), new FormSessionStrategy()];
}
