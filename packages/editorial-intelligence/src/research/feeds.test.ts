import { describe, expect, it } from 'vitest';

import { parseRssItems, splitPublisherSuffix, unwrapRedirect } from './feeds.js';
import { tierForPublisher, tierForUrl } from './sourceTiers.js';

describe('parseRssItems', () => {
  it('extracts title, link, description, date and source, decoding entities and CDATA', () => {
    const xml = `<rss><channel>
      <item><title>RBI hikes rate &amp; signals caution - Reuters</title>
        <link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;url=https%3a%2f%2fwww.reuters.com%2fa&amp;mkt=en-in</link>
        <description><![CDATA[<b>First</b> hike since 2023]]></description>
        <pubDate>Wed, 07 Oct 2026 06:00:00 GMT</pubDate>
        <source url="https://www.reuters.com">Reuters</source></item>
      <item><title></title></item>
    </channel></rss>`;
    const [item, ...rest] = parseRssItems(xml);
    expect(rest).toHaveLength(0);
    expect(item?.title).toBe('RBI hikes rate & signals caution - Reuters');
    expect(item?.link).toBe('https://www.reuters.com/a');
    expect(item?.description).toBe('First hike since 2023');
    expect(item?.publishedAt).toBe('2026-10-07T06:00:00.000Z');
    expect(item?.publisher).toBe('Reuters');
  });

  it('leaves non-redirect links untouched and splits publisher suffixes', () => {
    expect(unwrapRedirect('https://www.rbi.org.in/x?prid=1')).toBe('https://www.rbi.org.in/x?prid=1');
    expect(splitPublisherSuffix('RBI hikes rates - The Economic Times')).toEqual({
      headline: 'RBI hikes rates',
      publisher: 'The Economic Times',
    });
  });
});

describe('source tiers', () => {
  it('ranks regulators as primary, wires as secondary, and unknown sites as discovery-only', () => {
    expect(tierForUrl('https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx')).toBe('primary');
    expect(tierForUrl('https://pib.gov.in/release')).toBe('primary');
    expect(tierForUrl('https://www.reuters.com/markets/x')).toBe('secondary');
    expect(tierForUrl('https://inc42.com/x')).toBe('specialist');
    expect(tierForUrl('https://random-finance-blog.example/x')).toBe('discovery');
    expect(tierForPublisher('Reuters')).toBe('secondary');
    expect(tierForPublisher('Some Aggregator')).toBe('discovery');
  });
});
