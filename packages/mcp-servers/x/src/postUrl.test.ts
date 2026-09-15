import { describe, expect, it } from 'vitest';

import { buildPostUrl } from './postUrl.js';

describe('buildPostUrl', () => {
  it('builds a handle-qualified URL when the username is known', () => {
    expect(buildPostUrl('123', 'bullorbear')).toBe('https://x.com/bullorbear/status/123');
  });

  it('falls back to the handle-agnostic URL when the username is unknown', () => {
    expect(buildPostUrl('123', null)).toBe('https://x.com/i/web/status/123');
  });
});
