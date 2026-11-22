/**
 * Container platforms send SIGTERM before replacing an instance. Mark the
 * process unready at once so the load balancer stops routing to it, give
 * in-flight requests a bounded window to finish, then exit.
 */
let shuttingDown = false;

export function isShuttingDown(): boolean {
  return shuttingDown;
}

export function beginShutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stderr.write(
    `${JSON.stringify({ level: 30, service: 'curenear-web', signal, msg: 'web_draining' })}\n`,
  );
  setTimeout(() => process.exit(0), 10_000).unref();
}
