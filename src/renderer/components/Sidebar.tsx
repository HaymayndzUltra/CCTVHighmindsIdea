import { LayoutDashboard, ScrollText, Users, Settings, Shield, BarChart3, Map, ShieldAlert, Shapes } from 'lucide-react';

type Screen = 'dashboard' | 'event-log' | 'person-directory' | 'zone-editor' | 'analytics' | 'floor-plan' | 'situation-room' | 'settings';

interface SidebarProps {
  activeScreen: Screen;
  onNavigate: (screen: Screen) => void;
}

const navItems: { id: Screen; label: string; icon: typeof LayoutDashboard; group?: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'event-log', label: 'Events', icon: ScrollText },
  { id: 'person-directory', label: 'Persons', icon: Users },
  { id: 'zone-editor', label: 'Zones', icon: Shapes, group: 'divider' },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'floor-plan', label: 'Floor Plan', icon: Map },
  { id: 'situation-room', label: 'Sit Room', icon: ShieldAlert },
  { id: 'settings', label: 'Settings', icon: Settings, group: 'divider' },
];

export default function Sidebar({ activeScreen, onNavigate }: SidebarProps) {
  return (
    <nav
      className="flex h-full w-16 flex-col items-center gap-1 border-r border-neutral-800 bg-neutral-900 py-4"
      role="navigation"
      aria-label="Main navigation"
    >
      <div className="mb-6 text-xs font-bold tracking-wider text-primary-400">TAPO</div>

      {navItems.map(({ id, label, icon: Icon, group }) => {
        const isActive = activeScreen === id;
        return (
          <div key={id} className="w-full flex flex-col items-center">
            {group === 'divider' && (
              <div className="my-1 w-8 border-t border-neutral-800" />
            )}
            <button
              onClick={() => onNavigate(id)}
              className={`flex w-12 flex-col items-center gap-0.5 rounded-lg p-1.5 text-[9px] transition-colors ${
                isActive
                  ? 'bg-primary-600/20 text-primary-400'
                  : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
              }`}
              aria-current={isActive ? 'page' : undefined}
              title={label}
            >
              <Icon size={18} strokeWidth={1.5} />
              <span className="leading-tight">{label}</span>
            </button>
          </div>
        );
      })}
    </nav>
  );
}
