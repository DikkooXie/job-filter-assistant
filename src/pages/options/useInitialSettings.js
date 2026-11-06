import { useEffect } from 'react';
import { MSG } from '../../common/constants.js';
import { send } from '../../extension/messages.js';

export function useInitialSettings({ settingsRef, providersRef, profileRef, setSettings, setProviders, setProfile, report }) {
  useEffect(() => { let live = true; Promise.all([send(MSG.SETTINGS_GET), send(MSG.AI_PROVIDERS_GET), send(MSG.PROFILE_GET)]).then(([s, p, r]) => {
    if (!live) return; settingsRef.current = s; providersRef.current = p; profileRef.current = r; setSettings(s); setProviders(p); setProfile(r);
  }).catch((e) => { if (live) report(e.message, true); }); return () => { live = false; }; }, [report]);
}
