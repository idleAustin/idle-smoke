import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

export type PlatformId = 'web' | 'ios' | 'android';

export function getPlatform(): PlatformId {
  try {
    const raw = Capacitor.getPlatform();
    if (raw === 'ios' || raw === 'android') {
      return raw;
    }
  } catch {
    // Fallback to web when Capacitor runtime is unavailable
  }
  return 'web';
}

export function isNativeMobile(): boolean {
  const platform = getPlatform();
  return platform === 'ios' || platform === 'android';
}

function readLocalStorage(key: string): string | null {
  try {
    if (typeof globalThis.localStorage !== 'undefined') {
      return globalThis.localStorage.getItem(key);
    }
  } catch {
    // Ignore storage read errors in restricted environments
  }
  return null;
}

function writeLocalStorage(key: string, value: string): void {
  try {
    if (typeof globalThis.localStorage !== 'undefined') {
      globalThis.localStorage.setItem(key, value);
    }
  } catch {
    // Ignore storage write errors in restricted environments
  }
}

function removeLocalStorage(key: string): void {
  try {
    if (typeof globalThis.localStorage !== 'undefined') {
      globalThis.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage removal errors in restricted environments
  }
}

export const platformStorage = {
  getSync(key: string): string | null {
    return readLocalStorage(key);
  },

  setSync(key: string, value: string): void {
    void platformStorage.set(key, value);
  },

  removeSync(key: string): void {
    void platformStorage.remove(key);
  },

  async get(key: string): Promise<string | null> {
    if (isNativeMobile()) {
      try {
        const { value } = await Preferences.get({ key });
        if (value !== null && value !== undefined) {
          writeLocalStorage(key, value);
          return value;
        }
        const localFallback = readLocalStorage(key);
        if (localFallback !== null) {
          await Preferences.set({ key, value: localFallback });
          return localFallback;
        }
        return null;
      } catch {
        return readLocalStorage(key);
      }
    }
    return readLocalStorage(key);
  },

  async set(key: string, value: string): Promise<void> {
    writeLocalStorage(key, value);
    if (isNativeMobile()) {
      try {
        await Preferences.set({ key, value });
      } catch {
        // Fallback to localStorage already written above
      }
    }
  },

  async remove(key: string): Promise<void> {
    removeLocalStorage(key);
    if (isNativeMobile()) {
      try {
        await Preferences.remove({ key });
      } catch {
        // Fallback to localStorage removal already applied above
      }
    }
  },
};
