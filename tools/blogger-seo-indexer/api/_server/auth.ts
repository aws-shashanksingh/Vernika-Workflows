import { NextFunction, Request, Response } from 'express';
import { getRequestAccessToken, verifyAccessToken } from '../../../../api/access.js';

export async function handleCheckSession(req: Request, res: Response) {
  const session = await verifyAccessToken(getRequestAccessToken(req));
  const allowed = Boolean(
    session &&
    session.role === 'user' &&
    session.tools.includes('indexer') &&
    (!session.activeTool || session.activeTool === 'indexer'),
  );
  return res.json({
    authenticated: allowed,
    role: session?.role,
    activeTool: session?.activeTool,
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
    if (session.role !== 'user' || !session.tools.includes('indexer') || (session.activeTool && session.activeTool !== 'indexer')) {
      return res.status(403).json({ error: 'Sign in on the Indexer login screen with an account assigned to this tool.' });
    }
    res.locals.workflowSession = session;
    return next();
  } catch (error) {
    console.error('[Indexer auth] Session validation failed:', error);
    return res.status(503).json({ error: 'Unable to verify login session.' });
  }
}
