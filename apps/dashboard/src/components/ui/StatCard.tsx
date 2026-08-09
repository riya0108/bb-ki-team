export function StatCard({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
      {sublabel && <p className="mt-1 text-xs text-neutral-500">{sublabel}</p>}
    </div>
  );
}
