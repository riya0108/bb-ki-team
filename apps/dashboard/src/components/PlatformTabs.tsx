import { PLATFORM_LABELS, PLATFORMS } from '../api/client';
import type { Platform } from '../api/client';

interface PlatformTabsProps {
  selected: Platform;
  onSelect: (platform: Platform) => void;
}

export function PlatformTabs({ selected, onSelect }: PlatformTabsProps) {
  return (
    <div className="platform-tabs">
      {PLATFORMS.map((platform) => (
        <button
          key={platform}
          className={platform === selected ? 'active' : ''}
          onClick={() => onSelect(platform)}
        >
          {PLATFORM_LABELS[platform]}
        </button>
      ))}
    </div>
  );
}
