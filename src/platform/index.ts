import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { getPlatform, isNativeMobile, platformStorage, type PlatformId } from './storage';

function triggerWebVibrate(): void {
  try {
    globalThis.navigator?.vibrate?.(8);
  } catch {
    // Ignore vibration errors on unsupported browsers
  }
}

export async function triggerDragHaptic(): Promise<void> {
  if (isNativeMobile()) {
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
      return;
    } catch {
      triggerWebVibrate();
      return;
    }
  }
  triggerWebVibrate();
}

export { getPlatform, isNativeMobile, platformStorage, type PlatformId };
