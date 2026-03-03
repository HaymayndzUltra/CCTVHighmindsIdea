import { useState } from 'react';
import { MessageSquare, Shield, Camera, LayoutGrid, Monitor, Brain, Compass, Network, Map, HardDrive, Volume2, Cpu } from 'lucide-react';
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

export default function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('telegram');

  const renderTabContent = () => {
    switch (activeTab) {
      case 'telegram':
        return <TelegramConfig />;
      case 'privacy':
        return <RetentionConfig />;
      case 'cameras':
        return <CameraManagement />;
      case 'ptz':
        return <PTZConfig />;
      case 'topology':
        return <TopologyEditor />;
      case 'floorplan':
        return <FloorPlanEditor />;
      case 'ai':
        return <AIConfig />;
      case 'recording':
        return <RecordingConfig />;
      case 'zones':
        return <ZoneDefaults />;
      case 'sound':
        return <SoundDetectionConfig />;
      case 'llm':
        return <LLMConfig />;
      case 'layout':
        return <LayoutPreferences />;
      case 'system':
        return <SystemInfo />;
      default:
        return null;
    }
  };

  return (
    <div className="flex h-full flex-col p-6">
      <h1 className="mb-4 text-2xl font-semibold text-neutral-100">Settings</h1>

      {/* Tab Bar */}
      <div className="mb-6 flex gap-1 border-b border-neutral-800">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? 'border-primary-500 text-primary-400'
                : 'border-transparent text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-auto">{renderTabContent()}</div>
    </div>
  );
}
