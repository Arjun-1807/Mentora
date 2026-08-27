const STAGE_STYLES = {
  idea: "bg-amber-400/15 text-amber-300 border-amber-300/30",
  MVP: "bg-sky-400/15 text-sky-300 border-sky-300/30",
  growth: "bg-emerald-400/15 text-emerald-300 border-emerald-300/30",
};

export default function Badge({ children, tone = "default" }) {
  const toneClass =
    STAGE_STYLES[children] ||
    (tone === "accent"
      ? "bg-accent/15 text-accent border-accent/30"
      : "bg-white/10 text-white/80 border-white/20");

  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium border ${toneClass}`}
    >
      {children}
    </span>
  );
}
