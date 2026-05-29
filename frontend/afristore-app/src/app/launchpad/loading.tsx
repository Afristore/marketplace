// ─────────────────────────────────────────────────────────────
// app/(launchpad)/launchpad/loading.tsx — Launchpad Loading State
// ─────────────────────────────────────────────────────────────

export default function LaunchpadLoading() {
  return (
    <div className="min-h-screen bg-midnight-950 text-white pt-32 pb-20 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto flex flex-col items-center">
        {/* Shimmering Badge */}
        <div className="w-32 h-8 rounded-full bg-white/5 animate-pulse mb-6" />
        
        {/* Title Shimmer */}
        <div className="w-64 md:w-96 h-16 rounded-2xl bg-white/5 animate-pulse mb-6" />
        
        {/* Description Shimmer */}
        <div className="w-full max-w-2xl h-6 rounded-lg bg-white/5 animate-pulse mb-2" />
        <div className="w-2/3 max-w-md h-6 rounded-lg bg-white/5 animate-pulse mb-20" />

        {/* Features Grid Shimmer */}
        <div className="w-full grid gap-8 md:grid-cols-3 mb-24">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-8 rounded-[2rem] bg-white/5 border border-white/10 h-64 animate-pulse">
              <div className="w-12 h-12 rounded-2xl bg-white/10 mb-6" />
              <div className="w-1/2 h-6 rounded-lg bg-white/10 mb-3" />
              <div className="w-full h-4 rounded-lg bg-white/10 mb-2" />
              <div className="w-2/3 h-4 rounded-lg bg-white/10" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
