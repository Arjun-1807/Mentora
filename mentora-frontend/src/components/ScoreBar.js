export default function ScoreBar({ score }) {
  const raw = typeof score === "number" && !Number.isNaN(score) ? score : 0;
  const percent = Math.max(0, Math.min(100, raw <= 1 ? raw * 100 : raw));
  const rounded = Math.round(percent);

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs uppercase tracking-wide text-navy-100/60">
          Match score
        </span>
        <span className="text-sm font-semibold text-accent">{rounded}%</span>
      </div>
      <div className="h-2.5 w-full rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent-dark to-accent transition-all duration-500"
          style={{ width: `${rounded}%` }}
        />
      </div>
    </div>
  );
}
