import { useEffect, useState } from 'react';
import { isUpdatedHash, pageFromHash } from './pageHash.js';

export function useSettingsHash() {
  const [hash, setHash] = useState(() => location.hash);

  useEffect(() => {
    if (!location.hash) history.replaceState(null, '', '#profile');
    const sync = () => setHash(location.hash || '#profile');
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const current = hash || '#profile';
  return { hash: current, page: pageFromHash(current), updated: isUpdatedHash(current) };
}
