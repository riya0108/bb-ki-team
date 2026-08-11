/**
 * Shared by youtube-viral-finder and instagram-viral-finder: a 100K-view/like
 * post from a 20K-follower creator is a far stronger signal than the same
 * count from a 20M-follower creator (plan §38). Log-scaled since the raw
 * ratio can range from 0 to the millions: ratio 1 -> ~6, ratio 100 -> ~40,
 * ratio 10,000 -> ~80, ratio 100,000+ -> 100.
 */
export function computeOutlierScore(metricValue: number | undefined, audienceSize: number | undefined): number {
  if (metricValue === undefined || audienceSize === undefined) return 0;
  const ratio = metricValue / Math.max(audienceSize, 1);
  const score = 20 * Math.log10(ratio + 1);
  return Math.max(0, Math.min(100, Math.round(score)));
}
