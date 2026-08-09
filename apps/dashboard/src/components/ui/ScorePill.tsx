export function ScorePill({ score }: { score: number }) {
  const style =
    score >= 80
      ? 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/30'
      : score >= 50
        ? 'bg-amber-500/10 text-amber-400 ring-amber-500/30'
        : 'bg-rose-500/10 text-rose-400 ring-rose-500/30';

  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${style}`}>
      {score}
    </span>
  );
}
