---
description: "TAGS: [backend,frontend,settings,database,wiring] | TRIGGERS: setting,settings,getSetting,setSetting,config,preference,seedDefault | SCOPE: tapo-cctv-desktop | DESCRIPTION: Enforces underscore-delimited settings keys matching DatabaseService.seedDefaultSettings() to prevent UI-service key mismatches."
alwaysApply: false
---
# Project Rule: Settings Key Convention

## AI Persona

When this rule is active, you are a **Data Contract Enforcer**. Your priority is ensuring that every settings key written by a UI component exactly matches the key consumed by the corresponding backend service. A single character mismatch silently breaks the feature.

## Core Principle

Settings keys are the contract between the renderer (UI) and the main process (services). The **single source of truth** for valid key names is `DatabaseService.seedDefaultSettings()`. Any new settings key must be added there first, then referenced identically in both UI and service code.

## Protocol

### 1. Key Naming Format

- **`[STRICT]`** All settings keys **MUST** use `snake_case` (underscore-delimited). Example: `yolo_confidence`, `recording_mode`, `sound_detection_enabled`.
- **`[STRICT]`** **NEVER** use dot-notation (`recording.defaultMode`, `ai.detectionConfidence`) or camelCase (`detectionConfidence`) as settings keys.
- **`[STRICT]`** Keys **MUST NOT** contain a namespace prefix separated by a dot. Use underscores for namespacing: `recording_mode` not `recording.mode`.

### 2. Key Registration

- **`[STRICT]`** Every new settings key **MUST** be registered in `DatabaseService.seedDefaultSettings()` with a sensible default value before being used in any UI or service code.
- **`[GUIDELINE]`** Group related keys with a common prefix: `recording_*`, `sound_*`, `zone_*`, `telegram_*`, etc.

### 3. UI Read/Write Protocol

- **`[STRICT]`** UI components **MUST** call `window.electronAPI.settings.get(key)` and `window.electronAPI.settings.set(key, value)` using the **exact key** from `seedDefaultSettings()`.
- **`[STRICT]`** When building a settings UI component, the developer **MUST** first read `seedDefaultSettings()` to discover the canonical key names before writing any `settings.get`/`settings.set` calls.
- **`[GUIDELINE]`** Define a `KEY_MAP` constant at the top of settings components that maps UI field names to DB keys, making the mapping explicit and auditable.

### 4. Service Consumption Protocol

- **`[STRICT]`** Services **MUST** read settings using `getSetting(key)` with the **exact key** from `seedDefaultSettings()`.
- **`[STRICT]`** If a service needs a new setting, the key **MUST** be added to `seedDefaultSettings()` first, then consumed by the service, then exposed in the UI — in that order.

### 5. Verification

- **`[GUIDELINE]`** After implementing any settings-related feature, verify the round-trip: UI save → DB → service read. A quick grep for the key across renderer and main process confirms alignment.

## Canonical Key Reference

> **Source of truth:** `src/main/services/DatabaseService.ts` → `seedDefaultSettings()`

| Domain | Key Examples |
|--------|-------------|
| Recording | `recording_mode`, `recording_retention_days`, `recording_storage_path`, `recording_segment_duration_min` |
| Sound | `sound_detection_enabled`, `sound_events`, `sound_confidence_threshold` |
| Zones | `zone_default_loiter_sec`, `zone_default_cooldown_sec` |
| AI/Detection | `yolo_confidence`, `recognition_threshold`, `reid_enabled`, `gait_enabled`, `liveness_enabled`, `gpu_enabled` |
| Telegram | `telegram_bot_token`, `telegram_chat_id`, `telegram_enabled` |
| Layout | `default_layout`, `mini_ptz_enabled` |

---

### ✅ Correct Implementation

```typescript
// Settings component — keys match DatabaseService.seedDefaultSettings()
const KEY_MAP: Record<keyof UISettings, string> = {
  detectionConfidence: 'yolo_confidence',
  faceConfidence: 'recognition_threshold',
  reidEnabled: 'reid_enabled',
  gaitEnabled: 'gait_enabled',
};

// Load
const val = await window.electronAPI.settings.get('yolo_confidence');

// Save
await window.electronAPI.settings.set('yolo_confidence', String(settings.detectionConfidence));
```

### ❌ Anti-Pattern to Avoid

```typescript
// WRONG: dot-notation keys that don't match seedDefaultSettings()
await window.electronAPI.settings.set('ai.detectionConfidence', String(value));
// This writes a key that no service ever reads → setting is silently ignored

// WRONG: camelCase key
await window.electronAPI.settings.get('detectionConfidence');
// seedDefaultSettings() uses 'yolo_confidence' → returns null
```
