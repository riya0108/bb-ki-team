export function EmptyChartState({ label }: { label: string }) {
  return (
    <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-neutral-800 text-sm text-neutral-600">
      {label}
    </div>
  );
}
