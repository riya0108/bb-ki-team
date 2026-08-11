export function StatCard({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white/60 p-4 dark:border-neutral-800 dark:bg-neutral-900/40">
      <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-neutral-900 dark:text-white sm:text-2xl">{value}</p>
      {sublabel && <p className="mt-1 text-xs text-neutral-500">{sublabel}</p>}
    </div>
  );
}
