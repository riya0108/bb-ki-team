import type { ContentItem, YoutubeShortPackage } from '@bb/shared-types';
import { YoutubeShortPackageSchema } from '@bb/shared-types';

import type { DraftYoutubeShortOutput } from './draftShort.js';

// Assembles the YOUTUBE_SHORT output contract (spec 11.3). Phase 2 never publishes
// or schedules, so approvalRequired/publishAction are always the fixed values.
export function buildYoutubeShortPackage(item: ContentItem, draft: DraftYoutubeShortOutput): YoutubeShortPackage {
  return YoutubeShortPackageSchema.parse({
    contentId: item.id,
    status: item.status,
    topic: item.topic,
    corePromise: draft.corePromise,
    hookOptions: draft.hookOptions,
    titleOptions: draft.titleOptions,
    spokenScript: item.currentText,
    visualBeats: draft.visualBeats,
    onScreenText: draft.onScreenText,
    bRoll: draft.bRoll,
    editingPacing: draft.editingPacing,
    description: draft.description,
    sources: item.sourceUrls,
    cta: draft.cta,
    contentDnaVersion: item.contentDnaVersion,
    approvalRequired: true,
    publishAction: 'none',
  });
}
