import { useState } from 'react';

import { setStoredToken } from '../api/authToken';

interface LoginGateProps {
  // A real request that requires the shared-secret token (apps/api/src/auth.ts) —
  // used to verify what was typed actually works before dismissing the gate,
  // rather than trusting the input blindly and letting every subsequent request
  // 401 in a loop.
  verify: () => Promise<void>;
}

// Only ever shown once a real request 401s (see client.ts's onUnauthorized handler)
// — which can only happen against a deployed apps/api with DASHBOARD_SHARED_SECRET
// set. Local dev never triggers this.
export function LoginGate({ verify }: LoginGateProps) {
  const [token, setToken] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (!token.trim() || checking) return;
    setChecking(true);
    setError(null);
    setStoredToken(token.trim());
    try {
      await verify();
      window.location.reload();
    } catch {
      setError('That token was rejected. Check it and try again.');
      setChecking(false);
    }
  }

  return (
    <div className="login-gate">
      <div className="login-gate-card">
        <div className="login-gate-title">Teri</div>
        <p className="login-gate-sub">Enter the dashboard access token to continue.</p>
        <input
          type="password"
          autoFocus
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
          placeholder="Access token"
          disabled={checking}
        />
        {error && <div className="login-gate-error">{error}</div>}
        <button type="button" className="primary" onClick={() => void submit()} disabled={checking || !token.trim()}>
          {checking ? 'Checking…' : 'Continue'}
        </button>
      </div>
    </div>
  );
}
