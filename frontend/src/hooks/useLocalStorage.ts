import { useCallback, useState } from 'react';

/** String-valued localStorage-backed state. Safe when storage is unavailable. */
export function useStoredString(key: string, fallback = ''): [string, (v: string) => void] {
  const [value, setValue] = useState<string>(() => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch {
      return fallback;
    }
  });

  const set = useCallback(
    (v: string) => {
      setValue(v);
      try {
        localStorage.setItem(key, v);
      } catch {
        /* storage unavailable */
      }
    },
    [key],
  );

  return [value, set];
}
