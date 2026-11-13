# SYNC Life Widget architecture

The widget layer is kept separate from the existing SYNC application state. Its
input is a typed projection of that state; it does not create another editable
source of truth or change the existing `localStorage` format.

- `types.ts` defines the configuration and versioned snapshot contracts.
- `catalog.ts` lists supported modules and their display fields. A module is
  marked available only when SYNC currently has a corresponding source.
- `configuration.ts` validates and normalizes persisted widget preferences
  while retaining defaults for newly introduced modules.
- `snapshot.ts` projects tasks, agenda, finances, goals, habits, and reminders
  into a timestamped snapshot. It does not mutate input data.
- `priority-engine.ts` computes deterministic task order and explanations
  without mutating tasks; pinned tasks rank first and locked tasks retain their
  original positions when smart ordering is enabled.
- `WidgetCustomization.tsx` provides the in-app settings page and live
  preview using the existing SYNC data.
- `bridge.ts` calls the optional Capacitor native plugin only on native
  platforms. Browser builds return without attempting native synchronization.

The Android implementation lives under `android/app/src/main/java/com/sync/personal`:

- `WidgetBridgePlugin.kt` persists a versioned snapshot and configuration in
  app-private `SharedPreferences`, then updates installed widgets.
- `WidgetProvider.kt` renders responsive AppWidget sizes and deterministic
  priorities from that snapshot.
- `WidgetRefreshWorker.kt` refreshes cached widget views periodically with
  WorkManager. It does not need network access.

Native priority follows the TypeScript deadline/importance/pin rules. A native
completion action is intentionally omitted: without opening SYNC it cannot
atomically update the app's localStorage source of truth.

The current app has no Focus Management, Notes, or Health & Wellness data. Those
catalog entries are therefore unavailable and their snapshot sections remain
unavailable rather than containing placeholder data. The settings page and
priority engine, bridge, and Android AppWidget are implemented. The native
Gradle build still needs validation in an environment with Gradle, JDK, and
Android SDK platforms installed.
