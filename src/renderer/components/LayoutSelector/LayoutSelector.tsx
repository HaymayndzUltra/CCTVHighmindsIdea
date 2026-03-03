import { Grid2x2, Square, Columns3 } from 'lucide-react';
import type { LayoutMode } from '../CameraGrid/CameraGrid';

interface LayoutOption {
  mode: LayoutMode;
  label: string;
  icon: React.ReactNode;
}

interface LayoutSelectorProps {
  activeLayout: LayoutMode;
  onLayoutChange: (layout: LayoutMode) => void;
}

const LAYOUT_OPTIONS: LayoutOption[] = [
  { mode: '1x1', label: 'Single', icon: <Square className="h-4 w-4" /> },
  { mode: '2x2', label: '2×2 Grid', icon: <Grid2x2 className="h-4 w-4" /> },
  { mode: '3x1', label: '3×1 Row', icon: <Columns3 className="h-4 w-4" /> },
];

export default function LayoutSelector({ activeLayout, onLayoutChange }: LayoutSelectorProps) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-1">
      {LAYOUT_OPTIONS.map((option) => {
        const isActive = activeLayout === option.mode;
        return (
          <button
            key={option.mode}
            onClick={() => onLayoutChange(option.mode)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              isActive
                ? 'bg-neutral-700 text-neutral-100'
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
            title={option.label}
            aria-label={`Switch to ${option.label} layout`}
            aria-pressed={isActive}
          >
            {option.icon}
            <span className="hidden sm:inline">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
