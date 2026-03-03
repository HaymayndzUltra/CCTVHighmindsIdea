import CameraTile from '../CameraTile/CameraTile';

export type LayoutMode = '1x1' | '2x2' | '3x1' | 'custom';

interface CameraInfo {
  id: string;
  label: string;
  hasPtz?: boolean;
}

interface CameraGridProps {
  cameras: CameraInfo[];
  layout: LayoutMode;
  miniPtzEnabled?: boolean;
  onSelectCamera?: (cameraId: string) => void;
}

const LAYOUT_CLASSES: Record<LayoutMode, string> = {
  '1x1': 'grid-cols-1 grid-rows-1',
  '2x2': 'grid-cols-2 grid-rows-2',
  '3x1': 'grid-cols-3 grid-rows-1',
  'custom': 'grid-cols-2 grid-rows-2',
};

export default function CameraGrid({ cameras, layout, miniPtzEnabled, onSelectCamera }: CameraGridProps) {
  const gridClass = LAYOUT_CLASSES[layout] || LAYOUT_CLASSES['2x2'];

  // For 1x1 layout, only show the first camera
  const visibleCameras = layout === '1x1' ? cameras.slice(0, 1) : cameras;

  return (
    <div className={`grid h-full w-full gap-2 ${gridClass}`}>
      {visibleCameras.map((camera) => (
        <CameraTile
          key={camera.id}
          cameraId={camera.id}
          label={camera.label}
          hasPtz={camera.hasPtz}
          miniPtzEnabled={miniPtzEnabled}
          onSelect={onSelectCamera}
        />
      ))}
    </div>
  );
}
