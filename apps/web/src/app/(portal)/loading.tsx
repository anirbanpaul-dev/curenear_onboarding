/**
 * Shown as soon as a portal navigation starts, while the next page's server
 * data loads. Without a loading boundary Next keeps the old screen frozen until
 * the whole route is ready, which makes every link feel unresponsive.
 */
export default function PortalLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-6">
      <span className="sr-only">Loading page…</span>
      <div className="space-y-2">
        <div className="h-8 w-56 animate-pulse rounded bg-muted" />
        <div className="h-4 w-full max-w-xl animate-pulse rounded bg-muted" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-lg border bg-muted/40" />
        ))}
      </div>
      <div className="space-y-2 rounded-lg border p-4">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-10 animate-pulse rounded bg-muted/60" />
        ))}
      </div>
    </div>
  );
}
