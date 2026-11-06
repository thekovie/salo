/** Browser-side calls to Salo's API: one envelope, one error type. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
  /** No answer from the server at all (offline, dropped connection): safe to retry with the same key. */
  get isNetwork() {
    return this.status === 0;
  }
}

export function newKey(): string {
  return crypto.randomUUID();
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; idempotencyKey?: string } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method ?? "GET",
      headers: {
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(init.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "NETWORK", "No connection. Your change is kept and will be retried.");
  }
  const body = (await response.json().catch(() => null)) as { data?: T; error?: { code: string; message: string } } | null;
  if (body?.error?.code === "REMOVED" && typeof window !== "undefined") {
    // The host removed this guest: the page itself explains it (and offers to join again).
    window.location.reload();
  }
  if (!response.ok || body?.data === undefined) {
    throw new ApiError(response.status, body?.error?.code ?? "UNKNOWN", body?.error?.message ?? "Something went wrong. Try again.");
  }
  return body.data;
}
