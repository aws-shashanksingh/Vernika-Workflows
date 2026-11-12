import crypto from 'crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import express, { NextFunction, Request, Response } from 'express';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { withDatabaseScope } from '../tools/blogger-seo-indexer/api/_server/db.js';
import { decryptSecret, encryptSecret } from './secretStore.js';

type Tool = 'blogger' | 'indexer' | 'seo-pdf';
type Session = {
  id?: string;
  userId?: string;
  username: string;
  profileName?: string;
  accountExpiresAt?: string;
  role: 'admin' | 'user';
  tools: Tool[];
  exp: number;
};

const router = express.Router();
const TOKEN_COOKIE = 'vernika_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const supportedTools: Tool[] = ['blogger', 'indexer', 'seo-pdf'];
const ADMIN_DATA_OWNER_ID = '00000000-0000-4000-8000-000000000001';
let serviceClient: SupabaseClient | null = null;
const sessionCache = new Map<string, { expiresAt: number; session: Session | null }>();
const workflowRequestContext = new AsyncLocalStorage<Session>();

export function getWorkflowWorkspaceId(): string {
  const session = workflowRequestContext.getStore();
  return session?.userId || 'admin';
}

export function getWorkflowUserId(): string | null {
  return workflowRequestContext.getStore()?.userId || null;
}

export function getWorkflowDataOwnerId(): string {
  return getWorkflowUserId() || ADMIN_DATA_OWNER_ID;
}

export async function getStoredCredential(
  userId: string,
  tool: Tool,
  name: string,
): Promise<string | null> {
  const { data, error } = await getServiceClient()
    .from('workflow_secrets')
    .select('encrypted_value,iv,auth_tag')
    .eq('user_id', userId)
    .eq('tool', tool)
    .eq('name', name)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return decryptSecret({
    ciphertext: data.encrypted_value,
    iv: data.iv,
    authTag: data.auth_tag,
  });
}

export async function saveStoredCredential(
  userId: string,
  tool: Tool,
  name: string,
  value: string,
): Promise<void> {
  const encrypted = encryptSecret(value);
  const { error } = await getServiceClient()
    .from('workflow_secrets')
    .upsert({
      user_id: userId,
      tool,
      name,
      encrypted_value: encrypted.ciphertext,
      iv: encrypted.iv,
      auth_tag: encrypted.authTag,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,tool,name' });
  if (error) throw error;
}

export async function getStoredBloggerWorkflowConfig(userId: string): Promise<{
  webhookUrl: string;
  mcpUrl: string;
  apiKey: string;
} | null> {
  const stored = await getStoredCredential(userId, 'blogger', 'n8n-config');
  if (!stored) return null;
  const config: unknown = JSON.parse(stored);
  if (!config || typeof config !== 'object') {
    throw new Error('Stored Blogger workflow configuration is invalid.');
  }
  const value = config as Record<string, unknown>;
  return {
    webhookUrl: typeof value.webhookUrl === 'string' ? value.webhookUrl : '',
    mcpUrl: typeof value.mcpUrl === 'string' ? value.mcpUrl : '',
    apiKey: typeof value.apiKey === 'string' ? value.apiKey : '',
  };
}

function isSupportedN8nUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (url.hostname === 'n8n.cloud' ||
        url.hostname.endsWith('.n8n.cloud') ||
        url.hostname === 'n8n.io' ||
        url.hostname.endsWith('.n8n.io'));
  } catch {
    return false;
  }
}

function getServiceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured.');
  }
  if (!serviceClient) {
    serviceClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return serviceClient;
}

function getSigningSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 characters.');
  }
  return secret;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function sign(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', getSigningSecret()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function decode(token: string): Record<string, unknown> | null {
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra) return null;
  const expected = crypto.createHmac('sha256', getSigningSecret()).update(encoded).digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof payload.exp !== 'number' || payload.exp <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function getRequestAccessToken(req: Request): string | null {
  const authorization = req.header('authorization') || '';
  if (authorization.startsWith('Bearer ')) return authorization.slice(7).trim();
  const cookie = req.header('cookie') || '';
  const match = cookie.match(/(?:^|;\s*)vernika_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function hashValue(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function loginRateLimit(req: Request, step: 'login' | 'otp'): Promise<number> {
  const id = hashValue(`${step}:${req.ip || 'unknown'}`);
  const { data, error } = await getServiceClient()
    .from('workflow_login_attempts')
    .select('locked_until,expires_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  const lockedUntil = data?.locked_until ? new Date(data.locked_until).getTime() : 0;
  return lockedUntil > Date.now() ? Math.ceil((lockedUntil - Date.now()) / 1000) : 0;
}

async function recordLoginAttempt(req: Request, step: 'login' | 'otp', success: boolean): Promise<void> {
  const client = getServiceClient();
  const id = hashValue(`${step}:${req.ip || 'unknown'}`);
  if (success) {
    const { error } = await client.from('workflow_login_attempts').delete().eq('id', id);
    if (error) throw error;
    return;
  }

  const { data, error } = await client
    .from('workflow_login_attempts')
    .select('attempts')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  const attempts = Number(data?.attempts || 0) + 1;
  const lockedUntil = attempts >= 8 ? new Date(Date.now() + 10 * 60 * 1000).toISOString() : null;
  const { error: saveError } = await client.from('workflow_login_attempts').upsert({
    id,
    attempts: lockedUntil ? 0 : attempts,
    locked_until: lockedUntil,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });
  if (saveError) throw saveError;
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, encoded: string): boolean {
  const [salt, expectedHex] = encoded.split(':');
  if (!salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return expected.length > 0 && crypto.timingSafeEqual(actual, expected);
}

function getTool(value: unknown): Tool | null {
  return typeof value === 'string' && supportedTools.includes(value as Tool)
    ? value as Tool
    : null;
}

function setSessionCookie(res: Response, token: string): void {
  res.cookie(TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
  });
}

async function loadSession(token: string): Promise<Session | null> {
  const cached = sessionCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.session;
  const payload = decode(token);
  if (!payload || !['admin', 'user'].includes(String(payload.role))) return null;

  const session: Session = {
    id: typeof payload.sid === 'string' ? payload.sid : undefined,
    userId: typeof payload.uid === 'string' ? payload.uid : undefined,
    username: String(payload.username || ''),
    role: payload.role as Session['role'],
    tools: Array.isArray(payload.tools)
      ? payload.tools.filter((tool): tool is Tool => supportedTools.includes(tool as Tool))
      : [],
    exp: Number(payload.exp),
  };
  if (!session.username || (session.role === 'user' && (!session.id || !payload.uid))) return null;

  if (session.role === 'user') {
    const client = getServiceClient();
    const now = new Date().toISOString();
    const tokenHash = hashValue(token);
    const { data: activeSession, error: sessionError } = await client
      .from('workflow_sessions')
      .select('id,user_id')
      .eq('id', session.id)
      .eq('user_id', String(payload.uid))
      .eq('token_hash', tokenHash)
      .is('revoked_at', null)
      .gt('expires_at', now)
      .maybeSingle();
    if (sessionError) throw sessionError;
    if (!activeSession) return null;

    const { data: user, error: userError } = await client
      .from('workflow_users')
      .select('username,profile_name,status,expires_at,assigned_tools')
      .eq('id', String(payload.uid))
      .maybeSingle();
    if (userError) throw userError;
    if (
      !user ||
      user.status !== 'active' ||
      new Date(user.expires_at).getTime() <= Date.now() ||
      !Array.isArray(user.assigned_tools)
    ) return null;
    session.profileName = user.profile_name;
    session.accountExpiresAt = user.expires_at;
    session.tools = user.assigned_tools.filter((tool: string): tool is Tool => supportedTools.includes(tool as Tool));
  }

  sessionCache.set(token, { session, expiresAt: Math.min(Date.now() + 5000, session.exp) });
  return session;
}

export async function verifyAccessToken(token: string | null): Promise<Session | null> {
  if (!token) return null;
  return loadSession(token);
}

export function requireToolAccess(tool: Tool) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await verifyAccessToken(getRequestAccessToken(req));
      if (!session) return res.status(401).json({ error: 'Your session is invalid or expired. Please sign in again.' });
      if (!session.tools.includes(tool)) return res.status(403).json({ error: 'This account does not have access to this tool.' });
      res.locals.workflowSession = session;
      return workflowRequestContext.run(session, () =>
        withDatabaseScope(session.userId || ADMIN_DATA_OWNER_ID, next),
      );
    } catch (error) {
      console.error('[Access] Session validation failed:', error);
      return res.status(503).json({ error: 'Authentication service is temporarily unavailable.' });
    }
  };
}

export function requireApiToolAccess(req: Request, res: Response, next: NextFunction) {
  const path = req.path.replace(/^\/api(?=\/|$)/, '');
  let tool: Tool | null = null;
  if (/^\/(?:workflow|blogger|ai|images|storage|status)(?:\/|$)/.test(path)) tool = 'blogger';
  else if (/^\/(?:accounts|indexing|logs|auth|system|schema-sql)(?:\/|$)/.test(path)) tool = 'indexer';
  else if (/^\/(?:workspace-config|upload-profile-avatar|system-status|convert-pdf|sync-google-doc|check-google-sheet|sync-google-sheet|check-rank-usa|seo-check-urls|seo-bulk-ping)(?:\/|$)/.test(path)) tool = 'seo-pdf';
  if (!tool) return next();
  return requireToolAccess(tool)(req, res, next);
}

function publicUser(user: Record<string, unknown>) {
  return {
    id: user.id,
    profile_name: user.profile_name,
    username: user.username,
    status: user.status,
    expires_at: user.expires_at,
    assigned_tools: user.assigned_tools,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

async function recordActivity(
  userId: string | null,
  eventType: string,
  req: Request,
  details: Record<string, unknown> = {},
) {
  const client = getServiceClient();
  const { error } = await client.from('workflow_activity_logs').insert({
    user_id: userId,
    event_type: eventType,
    ip_address: req.ip || null,
    device_info: req.get('user-agent') || null,
    details,
  });
  if (error) throw error;
}

router.post('/api/access/login', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const tool = getTool(req.body?.tool) || 'blogger';
    const retryAfter = await loginRateLimit(req, 'login');
    if (retryAfter) return res.status(429).json({ error: `Too many failed sign-in attempts. Try again in ${retryAfter} seconds.` });
    const adminUsername = process.env.ADMIN_USERNAME;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminUsername || !adminPassword) {
      return res.status(503).json({ error: 'Admin login is not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD.' });
    }
    if (safeEqual(username, adminUsername) && safeEqual(password, adminPassword)) {
      await recordLoginAttempt(req, 'login', true);
      const challengeId = sign({
        kind: 'challenge',
        role: 'admin',
        username,
        tools: supportedTools,
        exp: Date.now() + CHALLENGE_TTL_MS,
        nonce: crypto.randomBytes(16).toString('hex'),
      });
      return res.json({ challengeId, requiresOtp: true });
    }

    const client = getServiceClient();
    const { data: user, error } = await client
      .from('workflow_users')
      .select('id,username,password_hash,otp_hash,status,expires_at,assigned_tools')
      .eq('username', username)
      .maybeSingle();
    if (error) throw error;
    if (!user || !verifyPassword(password, user.password_hash)) {
      await recordLoginAttempt(req, 'login', false);
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    await recordLoginAttempt(req, 'login', true);
    if (user.status !== 'active' || new Date(user.expires_at).getTime() <= Date.now()) {
      return res.status(403).json({ error: 'This account is expired or inactive. Contact your administrator.' });
    }
    const assignedTools = Array.isArray(user.assigned_tools)
      ? user.assigned_tools.filter((entry: string): entry is Tool => supportedTools.includes(entry as Tool))
      : [];
    if (!assignedTools.includes(tool)) {
      return res.status(403).json({ error: 'This account does not have access to the selected tool.' });
    }
    const challengeId = sign({
      kind: 'challenge',
      role: 'user',
      uid: user.id,
      username: user.username,
      tool,
      exp: Date.now() + CHALLENGE_TTL_MS,
      nonce: crypto.randomBytes(16).toString('hex'),
    });
    return res.json({ challengeId, requiresOtp: true });
  } catch (error) {
    console.error('[Access] Login failed:', error);
    return res.status(503).json({ error: 'Unable to verify login right now. Check the Supabase and auth environment settings.' });
  }
});

router.post('/api/access/verify', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const challenge = decode(String(req.body?.challengeId || ''));
    const otp = String(req.body?.otp || '').trim();
    if (!challenge || challenge.kind !== 'challenge' || otp.length < 6 || otp.length > 10) {
      return res.status(400).json({ error: 'OTP session expired or invalid. Please sign in again.' });
    }
    const retryAfter = await loginRateLimit(req, 'otp');
    if (retryAfter) return res.status(429).json({ error: `Too many failed verification attempts. Try again in ${retryAfter} seconds.` });

    let tools: Tool[] = [];
    let userId: string | null = null;
    if (challenge.role === 'admin') {
      const adminOtp = process.env.ADMIN_OTP;
      if (!adminOtp) return res.status(503).json({ error: 'Admin OTP is not configured. Set ADMIN_OTP.' });
      if (!safeEqual(otp, adminOtp)) {
        await recordLoginAttempt(req, 'otp', false);
        return res.status(401).json({ error: 'Invalid verification code.' });
      }
      tools = supportedTools;
    } else if (challenge.role === 'user' && typeof challenge.uid === 'string') {
      const client = getServiceClient();
      const { data: user, error } = await client
        .from('workflow_users')
        .select('id,username,otp_hash,status,expires_at,assigned_tools')
        .eq('id', challenge.uid)
        .maybeSingle();
      if (error) throw error;
      if (
        !user ||
        user.status !== 'active' ||
        new Date(user.expires_at).getTime() <= Date.now() ||
        !verifyPassword(otp, user.otp_hash)
      ) {
        await recordLoginAttempt(req, 'otp', false);
        return res.status(401).json({ error: 'Invalid verification code or inactive account.' });
      }

      tools = Array.isArray(user.assigned_tools)
        ? user.assigned_tools.filter((entry: string): entry is Tool => supportedTools.includes(entry as Tool))
        : [];
      const selectedTool = getTool(challenge.tool);
      if (!selectedTool || !tools.includes(selectedTool)) {
        return res.status(403).json({ error: 'This account does not have access to the selected tool.' });
      }
      userId = String(user.id);
    } else {
      return res.status(400).json({ error: 'Invalid login challenge.' });
    }
    await recordLoginAttempt(req, 'otp', true);

    const expiresAt = Date.now() + SESSION_TTL_MS;
    const sessionId = userId ? crypto.randomUUID() : undefined;
    const token = sign({
      role: challenge.role,
      uid: userId || undefined,
      sid: sessionId,
      username: String(challenge.username),
      tools,
      exp: expiresAt,
      nonce: crypto.randomBytes(16).toString('hex'),
    });

    if (userId && sessionId) {
      const client = getServiceClient();
      const now = new Date().toISOString();
      const { error: revokeError } = await client
        .from('workflow_sessions')
        .update({ revoked_at: now })
        .eq('user_id', userId)
        .is('revoked_at', null);
      if (revokeError) throw revokeError;
      const { error: insertError } = await client.from('workflow_sessions').insert({
        id: sessionId,
        user_id: userId,
        token_hash: hashValue(token),
        device_info: req.get('user-agent') || null,
        ip_address: req.ip || null,
        expires_at: new Date(expiresAt).toISOString(),
      });
      if (insertError) throw insertError;
      await recordActivity(userId, 'login', req, { tool: getTool(challenge.tool) });
    }

    setSessionCookie(res, token);
    return res.json({
      authenticated: true,
      role: challenge.role,
      username: String(challenge.username),
      tools,
      userId,
      workspaceId: userId || `admin-${hashValue(String(challenge.username)).slice(0, 16)}`,
      expiresAt,
    });
  } catch (error) {
    console.error('[Access] OTP verification failed:', error);
    return res.status(503).json({ error: 'Unable to verify login right now.' });
  }
});

router.get('/api/access/session', async (req, res) => {
  try {
    const session = await verifyAccessToken(getRequestAccessToken(req));
    if (!session) return res.json({ authenticated: false });
    return res.json({
      authenticated: true,
      ...session,
      workspaceId: session.userId || `admin-${hashValue(session.username).slice(0, 16)}`,
    });
  } catch (error) {
    console.error('[Access] Session lookup failed:', error);
    return res.status(503).json({ error: 'Unable to verify session right now.' });
  }
});

router.get('/api/account/credentials/blogger', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const session = await verifyAccessToken(getRequestAccessToken(req));
    if (!session) return res.status(401).json({ error: 'Sign in required.' });
    if (session.role !== 'user' || !session.userId || !session.tools.includes('blogger')) {
      return res.status(403).json({ error: 'Blogger account access is required.' });
    }
    const config = await getStoredBloggerWorkflowConfig(session.userId);
    return res.json({
      webhookUrl: config?.webhookUrl || process.env.N8N_WEBHOOK_URL || 'https://automated-blogger.app.n8n.cloud/webhook/seo-blog-generator',
      mcpUrl: config?.mcpUrl || process.env.N8N_MCP_URL || 'https://automated-blogger.app.n8n.cloud/mcp-server/http',
      apiKey: config?.apiKey || '',
    });
  } catch (error) {
    console.error('[Access] Blogger credential load failed:', error);
    return res.status(503).json({ error: 'Could not load Blogger integration settings.' });
  }
});

router.put('/api/account/credentials/blogger', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const session = await verifyAccessToken(getRequestAccessToken(req));
    if (!session) return res.status(401).json({ error: 'Sign in required.' });
    if (session.role !== 'user' || !session.userId || !session.tools.includes('blogger')) {
      return res.status(403).json({ error: 'Blogger account access is required.' });
    }
    const { webhookUrl, mcpUrl, apiKey } = req.body || {};
    if (!isSupportedN8nUrl(webhookUrl) || !isSupportedN8nUrl(mcpUrl)) {
      return res.status(400).json({ error: 'Use HTTPS URLs hosted on n8n.cloud or n8n.io.' });
    }
    if (typeof apiKey !== 'string' || apiKey.length > 4096) {
      return res.status(400).json({ error: 'The n8n API key is invalid.' });
    }
    await saveStoredCredential(
      session.userId,
      'blogger',
      'n8n-config',
      JSON.stringify({ webhookUrl, mcpUrl, apiKey }),
    );
    return res.json({ success: true });
  } catch (error) {
    console.error('[Access] Blogger credential save failed:', error);
    return res.status(503).json({ error: 'Could not securely save Blogger integration settings.' });
  }
});

router.put('/api/account/credentials/blogger/:name', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const allowedNames = new Set([
    'GOOGLE_REFRESH_TOKEN',
    'GEMINI_API_KEY',
    'DEEPSEEK_API_KEY',
    'POLLINATIONS_API_KEY',
  ]);
  const name = String(req.params.name || '');
  const value = req.body?.value;
  try {
    const session = await verifyAccessToken(getRequestAccessToken(req));
    if (!session) return res.status(401).json({ error: 'Sign in required.' });
    if (session.role !== 'user' || !session.userId || !session.tools.includes('blogger')) {
      return res.status(403).json({ error: 'Blogger account access is required.' });
    }
    if (!allowedNames.has(name) || typeof value !== 'string' || value.length > 16384) {
      return res.status(400).json({ error: 'Credential name or value is invalid.' });
    }
    if (value) {
      await saveStoredCredential(session.userId, 'blogger', name, value);
    } else if (req.body?.delete === true) {
      const { error } = await getServiceClient().from('workflow_secrets')
        .delete()
        .eq('user_id', session.userId)
        .eq('tool', 'blogger')
        .eq('name', name);
      if (error) throw error;
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('[Access] Customer credential save failed:', error);
    return res.status(503).json({ error: 'Could not securely save the integration credential.' });
  }
});

router.post('/api/access/unlock', async (req, res) => {
  try {
    const session = await verifyAccessToken(getRequestAccessToken(req));
    if (!session) return res.status(401).json({ error: 'Session expired. Sign in again.' });
    const providedOtp = String(req.body?.otp || '').trim();
    if (session.role === 'admin') {
      if (!process.env.ADMIN_OTP || !safeEqual(providedOtp, process.env.ADMIN_OTP)) {
        return res.status(401).json({ error: 'Invalid verification code.' });
      }
    } else {
      const client = getServiceClient();
      const { data: user, error } = await client
        .from('workflow_users')
        .select('otp_hash')
        .eq('username', session.username)
        .maybeSingle();
      if (error) throw error;
      if (!user || !verifyPassword(providedOtp, user.otp_hash)) {
        return res.status(401).json({ error: 'Invalid verification code.' });
      }
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('[Access] Session unlock failed:', error);
    return res.status(503).json({ error: 'Unable to verify session right now.' });
  }
});

router.post('/api/access/logout', async (req, res) => {
  try {
    const token = getRequestAccessToken(req);
    const session = await verifyAccessToken(token);
    if (session?.role === 'user' && session.id) {
      const client = getServiceClient();
      const { error } = await client.from('workflow_sessions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', session.id);
      if (error) throw error;
      sessionCache.delete(token || '');
    }
    res.clearCookie(TOKEN_COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
    return res.json({ success: true });
  } catch (error) {
    console.error('[Access] Logout failed:', error);
    return res.status(503).json({ error: 'Unable to end session right now.' });
  }
});

async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await verifyAccessToken(getRequestAccessToken(req));
    if (!session) return res.status(401).json({ error: 'Sign in required.' });
    if (session.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
    res.locals.workflowSession = session;
    return next();
  } catch (error) {
    console.error('[Admin] Authorization failed:', error);
    return res.status(503).json({ error: 'Unable to verify admin access.' });
  }
}

router.get('/api/admin/users', requireAdmin, async (_req, res) => {
  try {
    const { data, error } = await getServiceClient()
      .from('workflow_users')
      .select('id,profile_name,username,status,expires_at,assigned_tools,created_at,updated_at')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw error;
    return res.json(data || []);
  } catch (error) {
    console.error('[Admin] User list failed:', error);
    return res.status(503).json({ error: 'Could not load user accounts.' });
  }
});

router.post('/api/admin/users', requireAdmin, async (req, res) => {
  const profileName = String(req.body?.profile_name || '').trim();
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const otp = String(req.body?.otp || '').trim();
  const expiresAt = String(req.body?.expires_at || '');
  const assignedTools = Array.isArray(req.body?.assigned_tools)
    ? req.body.assigned_tools.filter((tool: unknown): tool is Tool => supportedTools.includes(tool as Tool))
    : [];
  if (!profileName || !username || password.length < 12 || otp.length < 6 || !expiresAt || !assignedTools.length) {
    return res.status(400).json({ error: 'Profile, username, 12+ character password, 6-10 digit OTP, expiry, and at least one tool are required.' });
  }
  if (new Date(expiresAt).getTime() <= Date.now() || otp.length > 10) {
    return res.status(400).json({ error: 'Expiry must be in the future and OTP must not exceed 10 digits.' });
  }
  try {
    const { data, error } = await getServiceClient()
      .from('workflow_users')
      .insert({
        profile_name: profileName,
        username,
        password_hash: hashPassword(password),
        otp_hash: hashPassword(otp),
        assigned_tools: assignedTools,
        expires_at: new Date(expiresAt).toISOString(),
        status: 'active',
      })
      .select('id,profile_name,username,status,expires_at,assigned_tools,created_at,updated_at')
      .single();
    if (error) throw error;
    await recordActivity(String(data.id), 'account_created', req, { assigned_tools: assignedTools });
    return res.status(201).json(publicUser(data));
  } catch (error) {
    console.error('[Admin] User creation failed:', error);
    return res.status(400).json({ error: 'Could not create account. The username may already be in use or the database may not be configured.' });
  }
});

router.patch('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const updates: Record<string, unknown> = {};
  const { profile_name, username, password, otp, status, expires_at, assigned_tools } = req.body || {};
  if (typeof profile_name === 'string' && profile_name.trim()) updates.profile_name = profile_name.trim();
  if (typeof username === 'string' && username.trim()) updates.username = username.trim();
  if (typeof password === 'string' && password.length >= 12) updates.password_hash = hashPassword(password);
  if (typeof otp === 'string' && otp.length >= 6 && otp.length <= 10) updates.otp_hash = hashPassword(otp);
  if (status === 'active' || status === 'expired' || status === 'disabled') updates.status = status;
  if (typeof expires_at === 'string' && new Date(expires_at).getTime() > Date.now()) {
    updates.expires_at = new Date(expires_at).toISOString();
  }
  if (Array.isArray(assigned_tools)) {
    updates.assigned_tools = assigned_tools.filter((tool: unknown): tool is Tool => supportedTools.includes(tool as Tool));
  }
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'No valid account changes were provided.' });

  try {
    updates.updated_at = new Date().toISOString();
    const client = getServiceClient();
    const { data, error } = await client
      .from('workflow_users')
      .update(updates)
      .eq('id', req.params.id)
      .select('id,profile_name,username,status,expires_at,assigned_tools,created_at,updated_at')
      .single();
    if (error) throw error;
    if (updates.status === 'disabled' || updates.status === 'expired' || updates.expires_at) {
      const { error: revokeError } = await client.from('workflow_sessions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('user_id', req.params.id)
        .is('revoked_at', null);
      if (revokeError) throw revokeError;
    }
    await recordActivity(req.params.id, 'account_updated', req, { changed_fields: Object.keys(updates) });
    sessionCache.clear();
    return res.json(publicUser(data));
  } catch (error) {
    console.error('[Admin] User update failed:', error);
    return res.status(400).json({ error: 'Could not update account.' });
  }
});

router.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const client = getServiceClient();
    const now = new Date().toISOString();
    const { error } = await client.from('workflow_users')
      .update({ status: 'disabled', updated_at: now })
      .eq('id', req.params.id);
    if (error) throw error;
    const { error: revokeError } = await client.from('workflow_sessions')
      .update({ revoked_at: now })
      .eq('user_id', req.params.id)
      .is('revoked_at', null);
    if (revokeError) throw revokeError;
    await recordActivity(req.params.id, 'account_disabled', req);
    sessionCache.clear();
    return res.json({ success: true });
  } catch (error) {
    console.error('[Admin] User disable failed:', error);
    return res.status(503).json({ error: 'Could not disable account.' });
  }
});

router.get('/api/admin/sessions', requireAdmin, async (_req, res) => {
  try {
    const { data, error } = await getServiceClient()
      .from('workflow_sessions')
      .select('id,user_id,device_info,ip_address,created_at,last_active_at,expires_at,revoked_at,workflow_users(profile_name,username)')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw error;
    return res.json((data || []).map((record) => ({
      ...record,
      duration_seconds: Math.max(
        0,
        Math.floor((Date.parse(record.last_active_at || record.created_at) - Date.parse(record.created_at)) / 1000),
      ),
    })));
  } catch (error) {
    console.error('[Admin] Session list failed:', error);
    return res.status(503).json({ error: 'Could not load login history.' });
  }
});

router.get('/api/admin/logs', requireAdmin, async (_req, res) => {
  try {
    const { data, error } = await getServiceClient()
      .from('workflow_activity_logs')
      .select('id,user_id,event_type,ip_address,device_info,details,created_at,workflow_users(profile_name,username)')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw error;
    return res.json(data || []);
  } catch (error) {
    console.error('[Admin] Activity log load failed:', error);
    return res.status(503).json({ error: 'Could not load activity logs.' });
  }
});

router.get('/api/admin/usage', requireAdmin, async (_req, res) => {
  try {
    const client = getServiceClient();
    const tables = [
      'workflow_users',
      'workflow_sessions',
      'workflow_activity_logs',
      'workflow_secrets',
      'workflow_login_attempts',
      'service_accounts',
      'url_logs',
      'requests',
      'blogs',
    ] as const;
    const results = await Promise.all(tables.map(async (table) => {
      const { count, error } = await client.from(table).select('id', { count: 'exact', head: true });
      if (error) throw new Error(`Could not count ${table}: ${error.message}`);
      return [table, count || 0] as const;
    }));
    const { data: storageByTable, error: storageError } = await client.rpc('vernika_storage_usage');
    if (storageError) throw new Error(`Could not load database storage sizes: ${storageError.message}`);
    return res.json({
      measuredAt: new Date().toISOString(),
      rowsByTable: Object.fromEntries(results),
      totalRows: results.reduce((total, [, count]) => total + count, 0),
      storageByTable: storageByTable || [],
      totalStorageBytes: (storageByTable || []).reduce(
        (total: number, row: { total_bytes?: number }) => total + Number(row.total_bytes || 0),
        0,
      ),
    });
  } catch (error) {
    console.error('[Admin] Usage report failed:', error);
    return res.status(503).json({ error: error instanceof Error ? error.message : 'Could not load usage report.' });
  }
});

router.post('/api/admin/cleanup', requireAdmin, async (_req, res) => {
  try {
    const client = getServiceClient();
    const now = new Date().toISOString();
    const [expiredSessions, revokedSessions, expiredAttempts] = await Promise.all([
      client.from('workflow_sessions').delete({ count: 'exact' }).lt('expires_at', now).is('revoked_at', null),
      client.from('workflow_sessions').delete({ count: 'exact' }).not('revoked_at', 'is', null),
      client.from('workflow_login_attempts').delete({ count: 'exact' }).lt('expires_at', now),
    ]);
    const errors = [expiredSessions.error, revokedSessions.error, expiredAttempts.error].filter(Boolean);
    if (errors.length) throw new Error(errors.map((error) => error?.message).join('; '));
    const deleted = {
      expiredSessions: expiredSessions.count || 0,
      revokedSessions: revokedSessions.count || 0,
      expiredLoginAttempts: expiredAttempts.count || 0,
    };
    await recordActivity(null, 'safe_cleanup_completed', _req, deleted);
    return res.json({ success: true, deleted });
  } catch (error) {
    console.error('[Admin] Safe cleanup failed:', error);
    return res.status(503).json({ error: 'Could not clean expired session and login-attempt records.' });
  }
});

router.get('/api/admin/users/:id/keys', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await getServiceClient()
      .from('workflow_secrets')
      .select('id,tool,name,created_at,updated_at')
      .eq('user_id', req.params.id)
      .order('tool')
      .order('name');
    if (error) throw error;
    return res.json(data || []);
  } catch (error) {
    console.error('[Admin] Credential metadata load failed:', error);
    return res.status(503).json({ error: 'Could not load credential metadata.' });
  }
});

router.post('/api/admin/users/:id/keys', requireAdmin, async (req, res) => {
  const tool = getTool(req.body?.tool);
  const name = String(req.body?.name || '').trim();
  const value = String(req.body?.value || '');
  const supportedCredentials: Record<Tool, Set<string>> = {
    blogger: new Set(['GOOGLE_REFRESH_TOKEN', 'GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'POLLINATIONS_API_KEY', 'n8n-config']),
    indexer: new Set(['GOOGLE_SERVICE_ACCOUNT_JSON']),
    'seo-pdf': new Set(['GOOGLE_SERVICE_ACCOUNT_JSON', 'GITHUB_TOKEN', 'INDEXNOW_KEY']),
  };
  if (!tool || !supportedCredentials[tool].has(name) || !value || value.length > 65536) {
    return res.status(400).json({ error: 'Choose a supported credential name and provide a value no larger than 64 KB.' });
  }
  try {
    const encrypted = encryptSecret(value);
    const client = getServiceClient();
    const { data, error } = await client.from('workflow_secrets')
      .upsert({
        user_id: req.params.id,
        tool,
        name,
        encrypted_value: encrypted.ciphertext,
        iv: encrypted.iv,
        auth_tag: encrypted.authTag,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,tool,name' })
      .select('id,tool,name,created_at,updated_at')
      .single();
    if (error) throw error;
    await recordActivity(req.params.id, 'credential_updated', req, { tool, name });
    return res.json(data);
  } catch (error) {
    console.error('[Admin] Credential save failed:', error);
    return res.status(503).json({ error: 'Could not securely save the credential. Check the encryption key and database setup.' });
  }
});

router.delete('/api/admin/users/:id/keys/:keyId', requireAdmin, async (req, res) => {
  try {
    const client = getServiceClient();
    const { data: credential, error: lookupError } = await client.from('workflow_secrets')
      .select('tool,name')
      .eq('id', req.params.keyId)
      .eq('user_id', req.params.id)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (credential?.tool === 'indexer' && credential.name === 'GOOGLE_SERVICE_ACCOUNT_JSON') {
      const { error: accountError } = await client.from('service_accounts')
        .delete()
        .eq('user_id', req.params.id)
        .eq('admin_managed', true);
      if (accountError) throw accountError;
    }
    const { error } = await client.from('workflow_secrets')
      .delete()
      .eq('id', req.params.keyId)
      .eq('user_id', req.params.id);
    if (error) throw error;
    await recordActivity(req.params.id, 'credential_deleted', req);
    return res.json({ success: true });
  } catch (error) {
    console.error('[Admin] Credential delete failed:', error);
    return res.status(503).json({ error: 'Could not delete the credential.' });
  }
});

export default router;
