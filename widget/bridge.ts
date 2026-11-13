import { Capacitor, registerPlugin } from "@capacitor/core";
import type { WidgetConfiguration, WidgetSnapshot } from "./types";

type WidgetSyncResult = {
  updatedAt: string;
  widgetCount: number;
};

type WidgetBridgePlugin = {
  syncWidgetData(options: {
    snapshot: WidgetSnapshot;
    configuration: WidgetConfiguration;
  }): Promise<WidgetSyncResult>;
};

const WidgetBridge = registerPlugin<WidgetBridgePlugin>("WidgetBridge");
let pendingSync: Promise<WidgetSyncResult> = Promise.resolve({ updatedAt: "", widgetCount: 0 });

export function isNativeWidgetBridgeAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

export function syncWidgetToNative(
  snapshot: WidgetSnapshot,
  configuration: WidgetConfiguration
): Promise<WidgetSyncResult | null> {
  if (!isNativeWidgetBridgeAvailable()) return Promise.resolve(null);

  const nextSync = pendingSync
    .catch(() => ({ updatedAt: "", widgetCount: 0 }))
    .then(() => WidgetBridge.syncWidgetData({ snapshot, configuration }));
  pendingSync = nextSync;
  return nextSync;
}
