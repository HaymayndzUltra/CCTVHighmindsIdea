import { useState } from 'react';
import { MessageSquare, Shield, Camera, LayoutGrid, Monitor, Brain, Compass, Network, Map, HardDrive, Volume2, Cpu } from 'lucide-react';
import { SettingsProvider, useSettings } from '../../contexts/SettingsContext';
import UnsavedChangesModal from '../../components/UnsavedChangesModal';
import CameraManagement from './CameraManagement';
import TelegramConfig from './TelegramConfig';
import RetentionConfig from './RetentionConfig';
import LayoutPreferences from './LayoutPreferences';
import SystemInfo from './SystemInfo';
import TopologyEditor from './TopologyEditor';
import FloorPlanEditor from './FloorPlanEditor';
import PTZConfig from './PTZConfig';
import AIConfig from './AIConfig';
import RecordingConfig from './RecordingConfig';
import ZoneDefaults from './ZoneDefaults';
import LLMConfig from './LLMConfig';
import SoundDetectionConfig from './SoundDetectionConfig';

type SettingsTab = 'telegram' | 'privacy' | 'cameras' | 'layout' | 'ptz' | 'topology' | 'floorplan' | 'recording' | 'system' | 'ai' | 'zones' | 'llm' | 'sound';

const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: 'telegram', label: 'Telegram', icon: <MessageSquare size={14} /> },
  { id: 'privacy', label: 'Retention', icon: <Shield size={14} /> },
  { id: 'cameras', label: 'Cameras', icon: <Camera size={14} /> },
  { id: 'ptz', label: 'PTZ', icon: <Compass size={14} /> },
  { id: 'ai', label: 'AI', icon: <Cpu size={14} /> },
  { id: 'recording', label: 'Recording', icon: <HardDrive size={14} /> },
  { id: 'zones', label: 'Zones', icon: <Shield size={14} /> },
  { id: 'sound', label: 'Sound', icon: <Volume2 size={14} /> },
  { id: 'llm', label: 'LLM', icon: <Brain size={14} /> },
  { id: 'topology', label: 'Topology', icon: <Network size={14} /> },
  { id: 'floorplan', label: 'Floor Plan', icon: <Map size={14} /> },
  { id: 'layout', label: 'Layout', icon: <LayoutGrid size={14} /> },
  { id: 'system', label: 'System', icon: <Monitor size={14} /> },
];

function SettingsContent() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('telegram');
  const [pendingTab, setPendingTab] = useState<SettingsTab | null>(null);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const { dirtyTabs, saveDraft, discardDraft } = useSettings();

  const handleTabSwitch = (newTab: SettingsTab) => {
    if (dirtyTabs.has(activeTab)) {
      setPendingTab(newTab);
      setShowUnsavedModal(true);
    } else {
      setActiveTab(newTab);
    }
  };

  const handleSaveAndSwitch = async () => {
    if (!pendingTab) return;
    
    try {
      const currentTabName = TABS.find((t) => t.id === activeTab)?.label || activeTab;
      await saveDraft(activeTab, async () => {
        const saveButton = document.querySelector(`[data-settings-save="${activeTab}"]`) as HTMLButtonElement;
        if (saveButton) {
          saveButton.click();
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      });
      setActiveTab(pendingTab);
    } catch (error) {
      console.error('[Settings] Save failed:', error);
    } finally {
      setShowUnsavedModal(false);
      setPendingTab(null);
    }
  };

  const handleDiscardAndSwitch = () => {
    if (!pendingTab) return;
    discardDraft(activeTab);
    setActiveTab(pendingTab);
    setShowUnsavedModal(false);
    setPendingTab(null);
  };

  const handleCancelSwitch = () => {
    setShowUnsavedModal(false);
    setPendingTab(null);
  };

  const renderTabContent = () => (
    <>
      <div className={activeTab === 'telegram' ? '' : 'hidden'}><TelegramConfig /></div>
      <div className={activeTab === 'privacy' ? '' : 'hidden'}><RetentionConfig /></div>
      <div className={activeTab === 'cameras' ? '' : 'hidden'}><CameraManagement /></div>
      <div className={activeTab === 'ptz' ? '' : 'hidden'}><PTZConfig /></div>
      <div className={activeTab === 'topology' ? '' : 'hidden'}><TopologyEditor /></div>
      <div className={activeTab === 'floorplan' ? '' : 'hidden'}><FloorPlanEditor /></div>
      <div className={activeTab === 'ai' ? '' : 'hidden'}><AIConfig /></div>
      <div className={activeTab === 'recording' ? '' : 'hidden'}><RecordingConfig /></div>
      <div className={activeTab === 'zones' ? '' : 'hidden'}><ZoneDefaults /></div>
      <div className={activeTab === 'sound' ? '' : 'hidden'}><SoundDetectionConfig /></div>
      <div className={activeTab === 'llm' ? '' : 'hidden'}><LLMConfig /></div>
      <div className={activeTab === 'layout' ? '' : 'hidden'}><LayoutPreferences /></div>
      <div className={activeTab === 'system' ? '' : 'hidden'}><SystemInfo /></div>
    </>
  );

  return (
    <div className="flex h-full flex-col p-6">
      <h1 className="mb-4 text-2xl font-semibold text-neutral-100">Settings</h1>

      {/* Tab Bar */}
      <div className="mb-6 flex gap-1 border-b border-neutral-800">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabSwitch(tab.id)}
            className={`relative flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? 'border-primary-500 text-primary-400'
                : 'border-transparent text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {tab.icon}
            {tab.label}
            {dirtyTabs.has(tab.id) && (
              <span className="ml-1 h-1.5 w-1.5 rounded-full bg-amber-400" title="Unsaved changes" />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-auto">{renderTabContent()}</div>

      <UnsavedChangesModal
        isOpen={showUnsavedModal}
        tabName={TABS.find((t) => t.id === activeTab)?.label || activeTab}
        onSave={handleSaveAndSwitch}
        onDiscard={handleDiscardAndSwitch}
        onCancel={handleCancelSwitch}
      />
    </div>
  );
}

export default function Settings() {
  return (
    <SettingsProvider>
      <SettingsContent />
    </SettingsProvider>
  );
}
