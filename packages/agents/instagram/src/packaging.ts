import type { ContentItem, InstagramPackage } from '@bb/shared-types';
import { InstagramPackageSchema } from '@bb/shared-types';

import type { DraftInstagramCarouselOutput } from './specialists/carousels.js';
import type { DraftInstagramPostOutput } from './specialists/posts.js';
import type { DraftInstagramReelOutput } from './specialists/reels.js';

const commonFields = (item: ContentItem): Pick<
  InstagramPackage,
  'contentId' | 'status' | 'contentDnaVersion' | 'sourceReferences' | 'approvalRequired' | 'publishAction'
> => ({
  contentId: item.id,
  status: item.status,
  contentDnaVersion: item.contentDnaVersion,
  sourceReferences: item.sourceUrls,
  approvalRequired: true,
  publishAction: 'none',
});

export function buildInstagramPostPackage(item: ContentItem, draft: DraftInstagramPostOutput): InstagramPackage {
  return InstagramPackageSchema.parse({ format: 'post', ...commonFields(item), ...draft });
}

export function buildInstagramCarouselPackage(
  item: ContentItem,
  draft: DraftInstagramCarouselOutput,
): InstagramPackage {
  return InstagramPackageSchema.parse({
    format: 'carousel',
    ...commonFields(item),
    ...draft,
    slideCount: draft.slides.length,
  });
}

export function buildInstagramReelPackage(item: ContentItem, draft: DraftInstagramReelOutput): InstagramPackage {
  return InstagramPackageSchema.parse({ format: 'reel', ...commonFields(item), ...draft });
}
