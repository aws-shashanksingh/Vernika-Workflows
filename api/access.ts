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
  activeTool?: Tool;
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
const sessionLastTouch = new Map<string, number>();
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
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error('Set SUPABASE_URL and either SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY.');
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
    activeTool: payload.role === 'user' ? (getTool(payload.activeTool) || undefined) : undefined,
    tools: payload.role === 'admin'
      ? []
      : Array.isArray(payload.tools)
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
    if (session.id && Date.now() - (sessionLastTouch.get(session.id) || 0) >= 30_000) {
      sessionLastTouch.set(session.id, Date.now());
      await client
        .from('workflow_sessions')
        .update({ last_active_at: now })
        .eq('id', session.id);
    }
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
      if (session.role !== 'user' || !session.tools.includes(tool)) {
        return res.status(403).json({ error: 'Sign in with a customer account assigned to this tool.' });
      }
      if (session.activeTool && session.activeTool !== tool) {
        return res.status(403).json({ error: `Sign in on the ${tool} login screen to access this tool.` });
      }
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

router.get('/api/access/health', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const encryptionKey = Buffer.from(process.env.CREDENTIAL_ENCRYPTION_KEY || '', 'base64');
  const checks = {
    supabaseUrl: Boolean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL),
    supabaseServerKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY),
    adminUsername: Boolean(process.env.ADMIN_USERNAME || 'rajputs'),
    adminPassword: Boolean(process.env.ADMIN_PASSWORD),
    adminOtp: /^\d{6,10}$/.test(process.env.ADMIN_OTP || ''),
    sessionSecret: (process.env.SESSION_SECRET || '').length >= 32,
    credentialEncryptionKey: encryptionKey.length === 32,
    loginSchema: false,
  };

  if (checks.supabaseUrl && checks.supabaseServerKey) {
    try {
      const client = getServiceClient();
      const [attemptsResult, usersResult, sessionsResult, activityResult] = await Promise.all([
        client.from('workflow_login_attempts').select('id').limit(1),
        client.from('workflow_users').select('id').limit(1),
        client.from('workflow_sessions').select('id').limit(1),
        client.from('workflow_activity_logs').select('id').limit(1),
      ]);
      checks.loginSchema = !attemptsResult.error &&
        !usersResult.error &&
        !sessionsResult.error &&
        !activityResult.error;
    } catch (error) {
      console.error('[Access] Health check failed:', error);
    }
  }

  res.json({
    checks,
    readyForAdminLogin: checks.supabaseUrl &&
      checks.supabaseServerKey &&
      checks.adminUsername &&
      checks.adminPassword &&
      checks.adminOtp &&
      checks.sessionSecret &&
      checks.loginSchema,
  });
});

router.post('/api/access/login', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const portal = String(req.body?.portal || '').trim();
    const tool = getTool(req.body?.tool) || 'blogger';
    const adminUsername = process.env.ADMIN_USERNAME || 'rajputs';
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
      return res.status(503).json({ error: 'Admin login is not configured. Set ADMIN_PASSWORD in Vercel.' });
    }
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
      return res.status(503).json({ error: 'Authentication is not configured. Set SESSION_SECRET to a random value of at least 32 characters in Vercel.' });
    }
    const retryAfter = await loginRateLimit(req, 'login');
    if (retryAfter) return res.status(429).json({ error: `Too many failed sign-in attempts. Try again in ${retryAfter} seconds.` });
    if (safeEqual(username, adminUsername) && safeEqual(password, adminPassword)) {
      await recordLoginAttempt(req, 'login', true);
      const challengeId = sign({
        kind: 'challenge',
        role: 'admin',
        username,
        portal: portal || 'admin',
        tools: [],
        exp: Date.now() + CHALLENGE_TTL_MS,
        nonce: crypto.randomBytes(16).toString('hex'),
      });
      return res.json({ challengeId, requiresOtp: true, role: 'admin' });
    }

    if (portal === 'admin') {
      await recordLoginAttempt(req, 'login', false);
      return res.status(403).json({ error: 'Only administrator accounts can sign into the Admin Console.' });
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
    return res.json({ challengeId, requiresOtp: true, role: 'user' });
  } catch (error) {
    console.error('[Access] Login failed:', error);
    return res.status(503).json({ error: 'Login could not reach the configured Supabase project or required login tables. Check /api/access/health and confirm supabase/vernika_complete_schema.sql was run on the same project.' });
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
    let activeTool: Tool | undefined;
    let profileName: string | undefined;
    let accountExpiresAt: string | undefined;

    if (challenge.role === 'admin') {
      const adminOtp = process.env.ADMIN_OTP;
      if (!adminOtp) return res.status(503).json({ error: 'Admin OTP is not configured. Set ADMIN_OTP.' });
      if (!safeEqual(otp, adminOtp)) {
        await recordLoginAttempt(req, 'otp', false);
        return res.status(401).json({ error: 'Invalid verification code.' });
      }
      tools = [];
    } else if (challenge.role === 'user' && typeof challenge.uid === 'string') {
      const client = getServiceClient();
      const { data: user, error } = await client
        .from('workflow_users')
        .select('id,profile_name,username,otp_hash,status,expires_at,assigned_tools')
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
      activeTool = selectedTool;
      profileName = user.profile_name;
      accountExpiresAt = user.expires_at;
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
      activeTool,
      tools,
      exp: expiresAt,
      nonce: crypto.randomBytes(16).toString('hex'),
    });

    if (challenge.role === 'admin') {
      await recordActivity(null, 'admin_login', req, { portal: String(challenge.portal || 'admin') });
    } else if (userId && sessionId) {
      const client = getServiceClient();
      const now = new Date().toISOString();
      const { error: revokeError } = await client
        .from('workflow_sessions')
        .update({ revoked_at: now, last_active_at: now })
        .eq('user_id', userId)
        .is('revoked_at', null);
      if (revokeError) throw revokeError;
      for (const [cachedToken, cachedEntry] of sessionCache.entries()) {
        if (cachedEntry.session?.userId === userId) sessionCache.delete(cachedToken);
      }
      const { error: insertError } = await client.from('workflow_sessions').insert({
        id: sessionId,
        user_id: userId,
        token_hash: hashValue(token),
        device_info: req.get('user-agent') || null,
        ip_address: req.ip || null,
        expires_at: new Date(expiresAt).toISOString(),
      });
      if (insertError) throw insertError;
      sessionLastTouch.set(sessionId, Date.now());
      await recordActivity(userId, 'login', req, { tool: activeTool });
    }

    setSessionCookie(res, token);
    return res.json({
      authenticated: true,
      role: challenge.role,
      username: String(challenge.username),
      profileName,
      accountExpiresAt,
      activeTool,
      tools,
      userId,
      workspaceId: userId || `admin-${hashValue(String(challenge.username)).slice(0, 16)}`,
      expiresAt,
      ...(challenge.role === 'admin' ? { redirectTo: '/admin/' } : {}),
    });
  } catch (error) {
    console.error('[Access] OTP verification failed:', error);
    return res.status(503).json({ error: 'Unable to verify login right now.' });
  }
});

router.get('/api/access/session', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const session = await verifyAccessToken(getRequestAccessToken(req));
    if (!session) return res.json({ authenticated: false });
    return res.json({
      authenticated: true,
      ...session,
      workspaceId: session.userId || `admin-${hashValue(session.username).slice(0, 16)}`,
      ...(session.role === 'admin' ? { redirectTo: '/admin/' } : {}),
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

router.get('/api/account/credentials/blogger/status', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const session = await verifyAccessToken(getRequestAccessToken(req));
    if (!session) return res.status(401).json({ error: 'Sign in required.' });
    if (session.role !== 'user' || !session.userId || !session.tools.includes('blogger')) {
      return res.json({
        hasRefreshToken: Boolean(process.env.GOOGLE_REFRESH_TOKEN),
        hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
        hasDeepSeekKey: Boolean(process.env.DEEPSEEK_API_KEY),
        hasPollinationsKey: Boolean(process.env.POLLINATIONS_API_KEY),
        hasN8nKey: Boolean(process.env.N8N_API_KEY),
      });
    }
    const { data, error } = await getServiceClient()
      .from('workflow_secrets')
      .select('name')
      .eq('user_id', session.userId)
      .eq('tool', 'blogger');
    if (error) throw error;
    const names = new Set((data || []).map((row) => String(row.name)));
    return res.json({
      hasRefreshToken: names.has('GOOGLE_REFRESH_TOKEN'),
      hasGeminiKey: names.has('GEMINI_API_KEY'),
      hasDeepSeekKey: names.has('DEEPSEEK_API_KEY'),
      hasPollinationsKey: names.has('POLLINATIONS_API_KEY'),
      hasN8nKey: names.has('n8n-config'),
    });
  } catch (error) {
    console.error('[Access] Blogger credential status load failed:', error);
    return res.status(503).json({ error: 'Could not check saved Blogger credentials.' });
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

router.get('/api/account/credentials/seo-pdf/status', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const session = await verifyAccessToken(getRequestAccessToken(req));
    if (!session) return res.status(401).json({ error: 'Sign in required.' });
    if (!session.tools.includes('seo-pdf')) {
      return res.status(403).json({ error: 'SEO PDF Studio access is required.' });
    }
    if (session.role !== 'user' || !session.userId) {
      return res.json({
        hasGithubToken: Boolean(process.env.GITHUB_TOKEN),
        hasIndexNowKey: Boolean(process.env.INDEXNOW_KEY),
      });
    }
    const { data, error } = await getServiceClient()
      .from('workflow_secrets')
      .select('name')
      .eq('user_id', session.userId)
      .eq('tool', 'seo-pdf');
    if (error) throw error;
    const names = new Set((data || []).map((row) => String(row.name)));
    return res.json({
      hasGithubToken: names.has('GITHUB_TOKEN'),
      hasIndexNowKey: names.has('INDEXNOW_KEY'),
    });
  } catch (error) {
    console.error('[Access] SEO PDF credential status load failed:', error);
    return res.status(503).json({ error: 'Could not check saved SEO PDF credentials.' });
  }
});

router.put('/api/account/credentials/seo-pdf/:name', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const allowedNames = new Set(['GITHUB_TOKEN', 'INDEXNOW_KEY']);
  const name = String(req.params.name || '');
  const value = req.body?.value;
  try {
    const session = await verifyAccessToken(getRequestAccessToken(req));
    if (!session) return res.status(401).json({ error: 'Sign in required.' });
    if (session.role !== 'user' || !session.userId || !session.tools.includes('seo-pdf')) {
      return res.status(403).json({ error: 'SEO PDF Studio account access is required.' });
    }
    if (!allowedNames.has(name) || typeof value !== 'string' || value.length > 16384) {
      return res.status(400).json({ error: 'Credential name or value is invalid.' });
    }
    if (value) {
      await saveStoredCredential(session.userId, 'seo-pdf', name, value);
    } else if (req.body?.delete === true) {
      const { error } = await getServiceClient().from('workflow_secrets')
        .delete()
        .eq('user_id', session.userId)
        .eq('tool', 'seo-pdf')
        .eq('name', name);
      if (error) throw error;
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('[Access] SEO PDF credential save failed:', error);
    return res.status(503).json({ error: 'Could not securely save the SEO PDF credential.' });
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
      return res.json({ success: true, role: 'admin', redirectTo: '/admin/' });
    }
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
    return res.json({ success: true, role: 'user', activeTool: session.activeTool });
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
      const now = new Date().toISOString();
      const client = getServiceClient();
      const { error } = await client.from('workflow_sessions')
        .update({ revoked_at: now, last_active_at: now })
        .eq('id', session.id);
      if (error) throw error;
      sessionLastTouch.delete(session.id);
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
    const now = new Date().toISOString();
    return res.json((data || []).map((record) => {
      const startMs = Date.parse(record.created_at);
      const isClosed = Boolean(record.revoked_at) || Date.parse(record.expires_at) <= Date.now();
      const endIso = record.last_active_at || (isClosed ? record.revoked_at || record.expires_at : now);
      return {
        ...record,
        duration_seconds: Math.max(
          0,
          Math.floor((Date.parse(endIso) - startMs) / 1000),
        ),
      };
    }));
  } catch (error) {
    console.error('[Admin] Session list failed:', error);
    return res.status(503).json({ error: 'Could not load login history.' });
  }
});

router.post('/api/admin/sessions/:id/revoke', requireAdmin, async (req, res) => {
  try {
    const client = getServiceClient();
    const now = new Date().toISOString();
    const { data, error } = await client
      .from('workflow_sessions')
      .update({ revoked_at: now, last_active_at: now })
      .eq('id', req.params.id)
      .is('revoked_at', null)
      .select('id,user_id')
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ error: 'Active session not found or already ended.' });
    }
    sessionLastTouch.delete(req.params.id);
    sessionCache.clear();
    await recordActivity(String(data.user_id), 'session_revoked', req, { session_id: req.params.id });
    return res.json({ success: true });
  } catch (error) {
    console.error('[Admin] Session revoke failed:', error);
    return res.status(503).json({ error: 'Could not revoke session.' });
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

router.get('/api/admin/active-users', requireAdmin, async (_req, res) => {
  try {
    const client = getServiceClient();
    const now = new Date().toISOString();
    const { data: activeSessions, error } = await client
      .from('workflow_sessions')
      .select('id,user_id,device_info,ip_address,created_at,last_active_at,expires_at,workflow_users(id,profile_name,username,status,expires_at,assigned_tools)')
      .is('revoked_at', null)
      .gt('expires_at', now)
      .order('last_active_at', { ascending: false })
      .limit(500);
    if (error) throw error;
    const rows = (activeSessions || []).map((record) => {
      const startMs = Date.parse(record.created_at);
      const endIso = record.last_active_at || now;
      return {
        ...record,
        duration_seconds: Math.max(0, Math.floor((Date.parse(endIso) - startMs) / 1000)),
      };
    });
    return res.json(rows);
  } catch (error) {
    console.error('[Admin] Active users load failed:', error);
    return res.status(503).json({ error: 'Could not load active users.' });
  }
});

router.get('/api/admin/security', requireAdmin, async (_req, res) => {
  try {
    const client = getServiceClient();
    const now = new Date().toISOString();
    const twoDaysLater = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const [activeRes, attemptsRes, overdueRes, expiringRes] = await Promise.all([
      client.from('workflow_sessions').select('id', { count: 'exact', head: true }).is('revoked_at', null).gt('expires_at', now),
      client.from('workflow_login_attempts').select('id,attempts,locked_until,expires_at,created_at').order('created_at', { ascending: false }).limit(200),
      client.from('workflow_users').select('id,profile_name,username,status,expires_at').eq('status', 'active').lte('expires_at', now),
      client.from('workflow_users').select('id,profile_name,username,status,expires_at').eq('status', 'active').gt('expires_at', now).lte('expires_at', twoDaysLater),
    ]);
    if (attemptsRes.error) throw attemptsRes.error;
    if (overdueRes.error) throw overdueRes.error;
    if (expiringRes.error) throw expiringRes.error;
    return res.json({
      activeSessionsCount: activeRes.count || 0,
      lockedAttempts: attemptsRes.data || [],
      overdueActiveUsers: overdueRes.data || [],
      expiringSoonUsers: expiringRes.data || [],
    });
  } catch (error) {
    console.error('[Admin] Security overview failed:', error);
    return res.status(503).json({ error: 'Could not load security management status.' });
  }
});

router.post('/api/admin/security/clear-attempts', requireAdmin, async (req, res) => {
  try {
    const client = getServiceClient();
    const attemptId = typeof req.body?.id === 'string' ? req.body.id : null;
    const query = client.from('workflow_login_attempts').delete({ count: 'exact' });
    const { count, error } = attemptId ? await query.eq('id', attemptId) : await query.neq('id', '');
    if (error) throw error;
    await recordActivity(null, 'attempts_cleared', req, { count: count || 0, id: attemptId || 'all' });
    return res.json({ success: true, cleared: count || 0 });
  } catch (error) {
    console.error('[Admin] Clear attempts failed:', error);
    return res.status(503).json({ error: 'Could not clear login attempt locks.' });
  }
});

router.post('/api/admin/security/revoke-all', requireAdmin, async (req, res) => {
  try {
    const client = getServiceClient();
    const now = new Date().toISOString();
    const { count, error } = await client
      .from('workflow_sessions')
      .update({ revoked_at: now, last_active_at: now }, { count: 'exact' })
      .is('revoked_at', null);
    if (error) throw error;
    sessionLastTouch.clear();
    sessionCache.clear();
    await recordActivity(null, 'all_sessions_revoked', req, { count: count || 0 });
    return res.json({ success: true, revoked: count || 0 });
  } catch (error) {
    console.error('[Admin] Revoke all sessions failed:', error);
    return res.status(503).json({ error: 'Could not revoke active sessions.' });
  }
});

router.post('/api/admin/security/sync-expired', requireAdmin, async (req, res) => {
  try {
    const client = getServiceClient();
    const now = new Date().toISOString();
    const { data: updatedUsers, error } = await client
      .from('workflow_users')
      .update({ status: 'expired', updated_at: now })
      .eq('status', 'active')
      .lte('expires_at', now)
      .select('id');
    if (error) throw error;
    const ids = (updatedUsers || []).map((row) => String(row.id));
    if (ids.length) {
      await client
        .from('workflow_sessions')
        .update({ revoked_at: now, last_active_at: now })
        .in('user_id', ids)
        .is('revoked_at', null);
      sessionCache.clear();
    }
    await recordActivity(null, 'overdue_accounts_expired', req, { count: ids.length });
    return res.json({ success: true, expiredCount: ids.length });
  } catch (error) {
    console.error('[Admin] Sync expired accounts failed:', error);
    return res.status(503).json({ error: 'Could not synchronize overdue accounts.' });
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
      'blog_posts',
      'blog_templates',
      'topics',
    ] as const;
    const results = await Promise.all(tables.map(async (table) => {
      const { count, error } = await client.from(table).select('id', { count: 'exact', head: true });
      if (error) return [table, 0] as const;
      return [table, count || 0] as const;
    }));
    const [secretsRes, inactiveSaRes, storageRes] = await Promise.all([
      client.from('workflow_secrets').select('id,user_id,workflow_users(status,expires_at)'),
      client.from('service_accounts').select('id', { count: 'exact', head: true }).eq('is_active', false),
      client.rpc('vernika_storage_usage'),
    ]);
    if (storageRes.error) throw new Error(`Could not load database storage sizes: ${storageRes.error.message}`);
    const unusedSecretsCount = (secretsRes.data || []).filter((row) => {
      const user = Array.isArray(row.workflow_users) ? row.workflow_users[0] : row.workflow_users;
      if (!user) return true;
      return user.status !== 'active' || Date.parse(user.expires_at) <= Date.now();
    }).length;
    const storageByTable = storageRes.data || [];
    return res.json({
      measuredAt: new Date().toISOString(),
      rowsByTable: Object.fromEntries(results),
      totalRows: results.reduce((total, [, count]) => total + count, 0),
      storageByTable,
      totalStorageBytes: storageByTable.reduce(
        (total: number, row: { total_bytes?: number }) => total + Number(row.total_bytes || 0),
        0,
      ),
      unusedSecretsCount,
      inactiveServiceAccountsCount: inactiveSaRes.count || 0,
    });
  } catch (error) {
    console.error('[Admin] Usage report failed:', error);
    return res.status(503).json({ error: error instanceof Error ? error.message : 'Could not load usage report.' });
  }
});

router.post('/api/admin/cleanup', requireAdmin, async (req, res) => {
  const rawScope = String(req.body?.scope || 'security');
  const scope: 'security' | 'logs' | 'unused_keys' | 'data' | 'all' =
    rawScope === 'logs' || rawScope === 'unused_keys' || rawScope === 'data' || rawScope === 'all'
      ? rawScope
      : 'security';
  try {
    const client = getServiceClient();
    const now = new Date().toISOString();
    const cutoff30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const deleted: Record<string, number> = {};

    if (scope === 'security' || scope === 'all') {
      const [expiredSessions, revokedSessions, expiredAttempts] = await Promise.all([
        client.from('workflow_sessions').delete({ count: 'exact' }).lt('expires_at', now).is('revoked_at', null),
        client.from('workflow_sessions').delete({ count: 'exact' }).not('revoked_at', 'is', null),
        client.from('workflow_login_attempts').delete({ count: 'exact' }).lt('expires_at', now),
      ]);
      const securityErrors = [expiredSessions.error, revokedSessions.error, expiredAttempts.error].filter(Boolean);
      if (securityErrors.length) throw new Error(securityErrors.map((err) => err?.message).join('; '));
      deleted.expiredSessions = expiredSessions.count || 0;
      deleted.revokedSessions = revokedSessions.count || 0;
      deleted.expiredLoginAttempts = expiredAttempts.count || 0;
    }

    if (scope === 'logs' || scope === 'data' || scope === 'all') {
      const [oldActivityLogs, oldUrlLogs, oldRequests] = await Promise.all([
        client.from('workflow_activity_logs').delete({ count: 'exact' }).lt('created_at', cutoff30Days),
        client.from('url_logs').delete({ count: 'exact' }).lt('created_at', cutoff30Days),
        client.from('requests').delete({ count: 'exact' }).in('status', ['completed', 'error']).lt('created_at', cutoff30Days),
      ]);
      const logErrors = [oldActivityLogs.error, oldUrlLogs.error, oldRequests.error].filter(Boolean);
      if (logErrors.length) throw new Error(logErrors.map((err) => err?.message).join('; '));
      deleted.oldActivityLogs = oldActivityLogs.count || 0;
      deleted.oldUrlLogs = oldUrlLogs.count || 0;
      deleted.oldWorkflowRequests = oldRequests.count || 0;
    }

    if (scope === 'unused_keys' || scope === 'all') {
      const [inactiveUsersRes, inactiveSaRes] = await Promise.all([
        client.from('workflow_users').select('id,status,expires_at'),
        client.from('service_accounts').delete({ count: 'exact' }).eq('is_active', false),
      ]);
      if (inactiveUsersRes.error) throw inactiveUsersRes.error;
      if (inactiveSaRes.error) throw inactiveSaRes.error;
      const staleUserIds = (inactiveUsersRes.data || [])
        .filter((u) => u.status !== 'active' || Date.parse(u.expires_at) <= Date.now())
        .map((u) => String(u.id));
      let deletedUnusedSecrets = 0;
      if (staleUserIds.length) {
        const { count, error: secretErr } = await client
          .from('workflow_secrets')
          .delete({ count: 'exact' })
          .in('user_id', staleUserIds);
        if (secretErr) throw secretErr;
        deletedUnusedSecrets = count || 0;
      }
      deleted.unusedCustomerKeys = deletedUnusedSecrets;
      deleted.inactiveServiceAccounts = inactiveSaRes.count || 0;
    }

    await recordActivity(null, 'safe_cleanup_completed', req, { scope, ...deleted });
    return res.json({ success: true, scope, deleted });
  } catch (error) {
    console.error('[Admin] Safe cleanup failed:', error);
    return res.status(503).json({ error: 'Could not clean obsolete records.' });
  }
});

router.get('/api/admin/keys', requireAdmin, async (_req, res) => {
  try {
    const client = getServiceClient();
    const [secretsRes, accountsRes, usersRes] = await Promise.all([
      client
        .from('workflow_secrets')
        .select('id,user_id,tool,name,created_at,updated_at,workflow_users(profile_name,username,status,expires_at)')
        .order('updated_at', { ascending: false })
        .limit(500),
      client
        .from('service_accounts')
        .select('id,user_id,project_name,client_email,daily_count,last_reset_date,is_active,admin_managed,created_at,updated_at')
        .order('created_at', { ascending: false })
        .limit(500),
      client
        .from('workflow_users')
        .select('id,profile_name,username,status,expires_at'),
    ]);
    if (secretsRes.error) throw secretsRes.error;
    if (accountsRes.error) throw accountsRes.error;
    if (usersRes.error) throw usersRes.error;

    const usersById = new Map((usersRes.data || []).map((user) => [String(user.id), user]));
    const secrets = (secretsRes.data || []).map((row) => {
      const user = Array.isArray(row.workflow_users) ? row.workflow_users[0] : row.workflow_users;
      const isUserActive = Boolean(user && user.status === 'active' && Date.parse(user.expires_at) > Date.now());
      return {
        id: row.id,
        user_id: row.user_id,
        tool: row.tool,
        name: row.name,
        created_at: row.created_at,
        updated_at: row.updated_at,
        profile_name: user?.profile_name || 'Unknown',
        username: user?.username || '',
        user_status: user ? (user.status === 'active' && Date.parse(user.expires_at) <= Date.now() ? 'expired' : user.status) : 'orphan',
        is_unused: !isUserActive,
      };
    });
    const serviceAccounts = (accountsRes.data || []).map((row) => {
      const user = usersById.get(String(row.user_id));
      const isUserActive = Boolean(user && user.status === 'active' && Date.parse(user.expires_at) > Date.now());
      return {
        ...row,
        profile_name: user?.profile_name || (row.user_id === ADMIN_DATA_OWNER_ID ? 'Legacy System Pool' : 'Unknown'),
        username: user?.username || '',
        is_unused: !row.is_active || (Boolean(user) && !isUserActive),
      };
    });

    return res.json({ secrets, serviceAccounts });
  } catch (error) {
    console.error('[Admin] All keys load failed:', error);
    return res.status(503).json({ error: 'Could not load saved credentials overview.' });
  }
});

router.delete('/api/admin/keys/secret/:keyId', requireAdmin, async (req, res) => {
  try {
    const client = getServiceClient();
    const { data: existing, error: lookupError } = await client
      .from('workflow_secrets')
      .select('id,user_id,tool,name')
      .eq('id', req.params.keyId)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!existing) return res.status(404).json({ error: 'Credential not found.' });
    if (existing.tool === 'indexer' && existing.name === 'GOOGLE_SERVICE_ACCOUNT_JSON') {
      await client.from('service_accounts').delete().eq('user_id', existing.user_id).eq('admin_managed', true);
    }
    const { error } = await client.from('workflow_secrets').delete().eq('id', req.params.keyId);
    if (error) throw error;
    await recordActivity(String(existing.user_id), 'credential_deleted', req, { tool: existing.tool, name: existing.name });
    return res.json({ success: true });
  } catch (error) {
    console.error('[Admin] Secret delete failed:', error);
    return res.status(503).json({ error: 'Could not delete saved credential.' });
  }
});

router.delete('/api/admin/keys/service-account/:id', requireAdmin, async (req, res) => {
  try {
    const client = getServiceClient();
    const { data: existing, error: lookupError } = await client
      .from('service_accounts')
      .select('id,user_id,project_name,client_email')
      .eq('id', req.params.id)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!existing) return res.status(404).json({ error: 'Service account not found.' });
    const { error } = await client.from('service_accounts').delete().eq('id', req.params.id);
    if (error) throw error;
    const userExists = existing.user_id && existing.user_id !== ADMIN_DATA_OWNER_ID ? String(existing.user_id) : null;
    await recordActivity(userExists, 'service_account_deleted', req, { project_name: existing.project_name, client_email: existing.client_email });
    return res.json({ success: true });
  } catch (error) {
    console.error('[Admin] Service account delete failed:', error);
    return res.status(503).json({ error: 'Could not delete service account.' });
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
  if (name === 'GOOGLE_SERVICE_ACCOUNT_JSON' || name === 'n8n-config') {
    try {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object') throw new Error('Invalid JSON object');
      if (name === 'GOOGLE_SERVICE_ACCOUNT_JSON' && (!parsed.client_email || !parsed.private_key)) {
        return res.status(400).json({ error: 'Service account JSON must contain client_email and private_key.' });
      }
    } catch {
      return res.status(400).json({ error: `${name} must contain valid JSON.` });
    }
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
