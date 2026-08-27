export default function Card({ children, className = "" }) {
  return (
    <div
      className={`rounded-2xl bg-navy-800 border border-white/10 shadow-card p-6 ${className}`}
    >
      {children}
    </div>
  );
}
