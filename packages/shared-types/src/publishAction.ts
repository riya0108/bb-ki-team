import { z } from 'zod';

// Every platform output contract (LINKEDIN_PACKAGE, X_PACKAGE, INSTAGRAM_*, YOUTUBE_SHORT)
// carries this field. Phase 1/2 have no publish connector at all, so it is always 'none'.
export const PublishActionSchema = z.enum(['none', 'schedule', 'publish']);
export type PublishAction = z.infer<typeof PublishActionSchema>;
