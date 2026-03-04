# Settings Context Migration Status

## ✅ Infrastructure (Complete)
- [x] SettingsContext.tsx - Centralized state provider
- [x] UnsavedChangesModal.tsx - Confirmation dialog
- [x] Settings.tsx - Provider integration + tab switch guard
- [x] Visual dirty indicators (amber dots on tabs)

## ✅ Migrated Components (2/13)
- [x] LLMConfig.tsx - Uses context, data-settings-save="llm"
- [x] AIConfig.tsx - Uses context, data-settings-save="ai"

## 🔄 In Progress (11/13)
- [ ] RecordingConfig.tsx - Similar pattern to LLM/AI
- [ ] ZoneDefaults.tsx - Similar pattern to LLM/AI
- [ ] SoundDetectionConfig.tsx - Similar pattern to LLM/AI
- [ ] TelegramConfig.tsx - Custom state (botToken, chatId, isEnabled)
- [ ] RetentionConfig.tsx - Custom state (retentionDays, autoPurgeEnabled)
- [ ] LayoutPreferences.tsx - Custom state (defaultLayout, miniPtzEnabled)
- [ ] CameraManagement.tsx - Complex per-camera edit state
- [ ] PTZConfig.tsx - Complex per-camera PTZ state
- [ ] TopologyEditor.tsx - Complex edges array state
- [ ] FloorPlanEditor.tsx - Complex camera positions + image upload
- [ ] SystemInfo.tsx - Read-only (no migration needed)

## Migration Pattern

### Simple Settings Object (LLM/AI/Recording/Zone/Sound)
```tsx
const TAB_ID = 'tabname';
const { draftSettings, updateDraftBulk, saveDraft } = useSettings();
const settings = (draftSettings[TAB_ID] as SettingsType) || DEFAULT_SETTINGS;

// onChange: updateDraftBulk(TAB_ID, { ...settings, key: value })
// onSave: await saveDraft(TAB_ID, async () => { /* IPC calls */ })
// Add: data-settings-save="tabname" to Save button
```

### Custom State (Telegram/Retention/Layout)
- Keep individual useState for each field
- Use updateDraft(TAB_ID, key, value) instead of updateDraftBulk
- Track dirty state via context

### Complex State (Camera/PTZ/Topology/FloorPlan)
- May need hybrid approach
- Keep complex local state for UI interactions
- Sync to context on blur/change
- Or refactor to use nested objects in context

## Next Steps
1. Batch migrate simple pattern components (Recording, Zone, Sound)
2. Migrate custom state components (Telegram, Retention, Layout)
3. Refactor complex components (Camera, PTZ, Topology, FloorPlan)
4. Test all tabs for persistence
5. Delete this file after completion
