import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Preferences } from '@capacitor/preferences';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getPlatform,
  isNativeMobile,
  platformStorage,
  triggerDragHaptic,
} from './index';

vi.mock('@capacitor/haptics', async importOriginal => {
  const actual = await importOriginal<typeof import('@capacitor/haptics')>();
  return {
    ...actual,
    Haptics: {
      impact: vi.fn(),
    },
  };
});

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
  },
}));

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

describe('Platform Adapter (src/platform/)', () => {
  let mockLocalStorage: Storage;

  beforeEach(() => {
    mockLocalStorage = createMemoryStorage();
    Object.defineProperty(globalThis, 'localStorage', {
      value: mockLocalStorage,
      configurable: true,
      writable: true,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    mockLocalStorage.clear();
    vi.restoreAllMocks();
  });

  it('detects web, ios, and android platforms via Capacitor.getPlatform()', () => {
    const spy = vi.spyOn(Capacitor, 'getPlatform');

    spy.mockReturnValue('web');
    expect(getPlatform()).toBe('web');
    expect(isNativeMobile()).toBe(false);

    spy.mockReturnValue('ios');
    expect(getPlatform()).toBe('ios');
    expect(isNativeMobile()).toBe(true);

    spy.mockReturnValue('android');
    expect(getPlatform()).toBe('android');
    expect(isNativeMobile()).toBe(true);

    spy.mockReturnValue('electron');
    expect(getPlatform()).toBe('web');
    expect(isNativeMobile()).toBe(false);
  });

  it('routes triggerDragHaptic() to Capacitor Haptics (ImpactStyle.Light) on native mobile and navigator.vibrate(8) on web', async () => {
    const platformSpy = vi.spyOn(Capacitor, 'getPlatform');
    const impactMock = vi.mocked(Haptics.impact).mockResolvedValue();
    const vibrateMock = vi.fn().mockReturnValue(true);
    Object.defineProperty(globalThis.navigator, 'vibrate', {
      value: vibrateMock,
      configurable: true,
      writable: true,
    });

    // Native iOS uses Taptic Engine Light impact
    platformSpy.mockReturnValue('ios');
    await triggerDragHaptic();
    expect(impactMock).toHaveBeenCalledTimes(1);
    expect(impactMock).toHaveBeenCalledWith({ style: ImpactStyle.Light });
    expect(vibrateMock).not.toHaveBeenCalled();

    // Web falls back to navigator.vibrate(8)
    impactMock.mockClear();
    platformSpy.mockReturnValue('web');
    await triggerDragHaptic();
    expect(impactMock).not.toHaveBeenCalled();
    expect(vibrateMock).toHaveBeenCalledTimes(1);
    expect(vibrateMock).toHaveBeenCalledWith(8);

    // Native fallback to navigator.vibrate(8) if Haptics.impact rejects
    vibrateMock.mockClear();
    platformSpy.mockReturnValue('android');
    impactMock.mockRejectedValueOnce(new Error('Haptics plugin unavailable'));
    await expect(triggerDragHaptic()).resolves.toBeUndefined();
    expect(vibrateMock).toHaveBeenCalledWith(8);
  });

  it('persists key-value state via @capacitor/preferences on native mobile and localStorage on web', async () => {
    const platformSpy = vi.spyOn(Capacitor, 'getPlatform');
    const nativeStore = new Map<string, string>();

    const getMock = vi.mocked(Preferences.get).mockImplementation(async ({ key }) => ({
      value: nativeStore.get(key) ?? null,
    }));
    const setMock = vi.mocked(Preferences.set).mockImplementation(async ({ key, value }) => {
      nativeStore.set(key, value);
    });
    const removeMock = vi.mocked(Preferences.remove).mockImplementation(async ({ key }) => {
      nativeStore.delete(key);
    });

    // Web mode uses localStorage directly without calling native Preferences
    platformSpy.mockReturnValue('web');
    await platformStorage.set('smokebreak.playerToken', 'web-token-123');
    expect(mockLocalStorage.getItem('smokebreak.playerToken')).toBe('web-token-123');
    expect(platformStorage.getSync('smokebreak.playerToken')).toBe('web-token-123');
    expect(await platformStorage.get('smokebreak.playerToken')).toBe('web-token-123');
    expect(setMock).not.toHaveBeenCalled();

    await platformStorage.remove('smokebreak.playerToken');
    expect(await platformStorage.get('smokebreak.playerToken')).toBeNull();

    // Native iOS mode persists to @capacitor/preferences and restores if WebView localStorage is evicted
    platformSpy.mockReturnValue('ios');
    await platformStorage.set('smokebreak.playerToken', 'ios-token-456');
    expect(setMock).toHaveBeenCalledWith({
      key: 'smokebreak.playerToken',
      value: 'ios-token-456',
    });
    expect(platformStorage.getSync('smokebreak.playerToken')).toBe('ios-token-456');

    // Simulate iOS WKWebView memory pressure wiping localStorage while NSUserDefaults retains Preferences
    mockLocalStorage.clear();
    const restored = await platformStorage.get('smokebreak.playerToken');
    expect(getMock).toHaveBeenCalledWith({ key: 'smokebreak.playerToken' });
    expect(restored).toBe('ios-token-456');
    expect(platformStorage.getSync('smokebreak.playerToken')).toBe('ios-token-456');

    // Removing on native mobile clears both Preferences and localStorage
    await platformStorage.remove('smokebreak.playerToken');
    expect(removeMock).toHaveBeenCalledWith({ key: 'smokebreak.playerToken' });
    expect(await platformStorage.get('smokebreak.playerToken')).toBeNull();
    expect(platformStorage.getSync('smokebreak.playerToken')).toBeNull();
  });
});

