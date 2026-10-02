'use client';

import { useCallback, useEffect, useState } from 'react';

export interface Resource<T> {
  /** Null until the first load succeeds. */
  value: T | null;
  /** The last load's failure, if it failed; the previous value is kept. */
  error: unknown;
  /** Loads again, e.g. after a change was saved. */
  reload: () => void;
}

/** Loads once on mount, and again on `reload()`; a late answer to an old load is dropped. */
export function useResource<T>(load: () => Promise<T>): Resource<T> {
  const [state, setState] = useState<{ value: T | null; error: unknown }>({
    value: null,
    error: null,
  });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let current = true;
    load().then(
      (value) => current && setState({ value, error: null }),
      (error: unknown) => current && setState((previous) => ({ value: previous.value, error })),
    );
    return () => {
      current = false;
    };
    // `load` is a fresh closure each render; `version` says when to run it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const reload = useCallback(() => setVersion((current) => current + 1), []);
  return { ...state, reload };
}
