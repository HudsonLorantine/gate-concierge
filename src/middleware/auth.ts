import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

/**
 * Basic auth middleware for admin routes.
 */
export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Gate Concierge Admin"');
    res.status(401).send('Authentication required');
    return;
  }

  const base64 = authHeader.slice(6);
  const [username, password] = Buffer.from(base64, 'base64').toString().split(':');

  if (username === config.admin.username && password === config.admin.password) {
    next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="Gate Concierge Admin"');
    res.status(401).send('Invalid credentials');
  }
}
