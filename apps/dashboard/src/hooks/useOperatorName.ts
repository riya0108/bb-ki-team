import { useEffect, useState } from 'react';

const STORAGE_KEY = 'bb-dashboard-operator-name';

// This is a single-operator internal tool (no auth layer yet) — every approval/
// edit/confirmation attributes to whatever name is set here, persisted locally so
// it doesn't need re-entering every session.
export function useOperatorName(): [string, (name: string) => void] {
  const [name, setName] = useState(() => localStorage.getItem(STORAGE_KEY) ?? '');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, name);
  }, [name]);

  return [name, setName];
}
