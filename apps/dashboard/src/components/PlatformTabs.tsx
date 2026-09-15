import { PLATFORM_LABELS, PLATFORMS } from '../api/client';
import type { Platform } from '../api/client';
import { PlatformIcon } from './icons';

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
          type="button"
          className={`platform-chip${platform === selected ? ' active' : ''}`}
          onClick={() => onSelect(platform)}
        >
          <PlatformIcon platform={platform} />
          {PLATFORM_LABELS[platform]}
        </button>
      ))}
    </div>
  );
}
