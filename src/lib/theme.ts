import { useEffect, useSyncExternalStore } from 'react';
import { useProgress } from '../state/store';

const media = window.matchMedia('(prefers-color-scheme: dark)');

function subscribeMedia(cb: () => void) {
  media.addEventListener('change', cb);
  return () => media.removeEventListener('change', cb);
}

/** The theme actually shown: the saved choice, or the OS preference when set to "system". */
export function useResolvedTheme(): 'light' | 'dark' {
  const { settings } = useProgress();
  const systemDark = useSyncExternalStore(subscribeMedia, () => media.matches);
  if (settings.theme === 'system') return systemDark ? 'dark' : 'light';
  return settings.theme;
}

/** Keeps <html data-theme> in step with the resolved theme. Mount once at the root. */
export function useApplyTheme() {
  const theme = useResolvedTheme();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
}
