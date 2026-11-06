/**
 * One instance per process, kept on globalThis so a dev-server module reload does not reset it (a reset would
 * quietly forget rate-limit counts and pending previews). In production the module is loaded once anyway.
 */
export function singleton<T>(key: string, create: () => T): T {
  const store = globalThis as unknown as Record<string, unknown>;
  const name = `__salo_${key}`;
  if (!(name in store)) store[name] = create();
  return store[name] as T;
}
