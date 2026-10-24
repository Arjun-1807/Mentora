/**
 * App-wide ambient background, fixed behind every page: three slow-drifting
 * aurora blobs (primary, spark, teal) over a faint grid that fades out
 * towards the edges. Purely decorative and pointer-transparent.
 */
export default function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-grid [mask-image:radial-gradient(ellipse_80%_60%_at_50%_0%,black_30%,transparent_75%)]" />
      <div className="animate-aurora absolute -top-[30%] left-[10%] h-[70vh] w-[70vh] rounded-full bg-[var(--backdrop-a)] blur-[110px]" />
      <div
        className="animate-aurora absolute -top-[15%] right-[-5%] h-[55vh] w-[55vh] rounded-full bg-[var(--backdrop-b)] blur-[120px]"
        style={{ animationDelay: "-6s" }}
      />
      <div
        className="animate-aurora absolute top-[45%] left-[-10%] h-[50vh] w-[50vh] rounded-full bg-[var(--backdrop-c)] blur-[120px]"
        style={{ animationDelay: "-12s" }}
      />
    </div>
  );
}
