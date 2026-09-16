import { timingSafeEqual } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

// Single-operator shared-secret gate — not a real user-account/session system, by
// design. This app has exactly one intended operator (CLAUDE.md: "a trusted local
// operator tool"); the only thing that changed (2026-09-16) is that it's no longer
// guaranteed to be reachable only from loopback, since apps/api can now be deployed
// somewhere internet-reachable so the dashboard works from a phone. If
// DASHBOARD_SHARED_SECRET is unset, this middleware is a no-op — local dev against
// 127.0.0.1 stays exactly as frictionless as before. Once it's set (i.e. this is
// deployed somewhere reachable from the internet), every request except /health must
// carry it.
function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Length must match before timingSafeEqual (it throws on mismatched lengths) —
  // comparing against a fixed-length hash of both sides keeps this step itself
  // constant-time rather than short-circuiting on length alone.
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function sharedSecretAuth(secret: string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!secret) {
      next();
      return;
    }
    if (req.path === '/health') {
      next();
      return;
    }

    const header = req.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

    if (!token || !timingSafeStringEqual(token, secret)) {
      res.status(401).json({ error: 'Unauthorized', message: 'Missing or invalid dashboard token.' });
      return;
    }
    next();
  };
}
