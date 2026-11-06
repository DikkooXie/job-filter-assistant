import { useEffect } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { MSG } from '../../common/constants.js';
import { send } from '../../extension/messages.js';
import type { AIProvider, Profile, Settings } from '../../common/types.js';

export interface InitialSettingsOptions {
  settingsRef: MutableRefObject<Settings | null>;
  providersRef: MutableRefObject<AIProvider[]>;
  profileRef: MutableRefObject<Profile | null>;
  setSettings: Dispatch<SetStateAction<Settings | null>>;
  setProviders: Dispatch<SetStateAction<AIProvider[]>>;
  setProfile: Dispatch<SetStateAction<Profile | null>>;
  report: (message: string | null, isError?: boolean) => void;
}

export function useInitialSettings({
  settingsRef,
  providersRef,
  profileRef,
  setSettings,
  setProviders,
  setProfile,
  report,
}: InitialSettingsOptions): void {
  useEffect(() => {
    let live = true;
    Promise.all([
      send<Settings>(MSG.SETTINGS_GET),
      send<AIProvider[]>(MSG.AI_PROVIDERS_GET),
      send<Profile>(MSG.PROFILE_GET),
    ]).then(([s, p, r]) => {
      if (!live) return;
      settingsRef.current = s;
      providersRef.current = p;
      profileRef.current = r;
      setSettings(s);
      setProviders(p);
      setProfile(r);
    }).catch((e: unknown) => {
      if (live) report(e instanceof Error ? e.message : String(e), true);
    });
    return () => { live = false; };
  }, [report]);
}
