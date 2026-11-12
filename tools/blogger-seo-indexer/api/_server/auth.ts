import { NextFunction, Request, Response } from 'express';
import { getRequestAccessToken, verifyAccessToken } from '../../../../api/access.js';

export async function handleCheckSession(req: Request, res: Response) {
  const session = await verifyAccessToken(getRequestAccessToken(req));
  return res.json({
    authenticated: Boolean(session?.tools.includes('indexer')),
    role: session?.role,
  });
}

export function handleLogout(_req: Request, res: Response) {
  return res.json({ success: true });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await verifyAccessToken(getRequestAccessToken(req));
    if (!session) {
      return res.status(401).json({ error: 'Your session is invalid or expired. Please sign in again.' });
    }
    if (!session.tools.includes('indexer')) {
      return res.status(403).json({ error: 'This account does not have access to the indexer.' });
    }
    res.locals.workflowSession = session;
    return next();
  } catch (error) {
    console.error('[Indexer auth] Session validation failed:', error);
    return res.status(503).json({ error: 'Unable to verify login session.' });
  }
}
