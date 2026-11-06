import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** The dedicated Salo PostgreSQL database (never Coolify's own coolify-db). */
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((value) => /^postgres(ql)?:\/\//.test(value), "must be a postgres:// connection URL"),
  /** Public address: invite links, QR codes and link previews are built from it. */
  APP_URL: z.url(),
  /** Closed sessions stay read-only this long, then are deleted (brief 12.1). */
  CLOSED_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  /** Sessions never closed are deleted after this long without activity (brief 12.2). */
  INACTIVE_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
});

export type Env = z.infer<typeof schema>;

function invalid(message: string): never {
  throw new Error(`Invalid environment:\n${message}`);
}

/** An empty value (`APP_URL=` in a copied .env) means "not set", not "set to an empty string". */
function withoutEmpty(source: Record<string, string | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [key, value === "" ? undefined : value]));
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = schema.safeParse(withoutEmpty(source));
  if (!parsed.success) invalid(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n"));
  const env = parsed.data;
  if (env.NODE_ENV === "production") {
    const { protocol, hostname } = new URL(env.APP_URL);
    if (protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
      invalid("APP_URL must use https in production (plain http is only allowed for localhost)");
    }
  }
  return env;
}

let cached: Env | undefined;
/** Lazily validated process environment (server only). */
export function getEnv(): Env {
  return (cached ??= parseEnv(process.env));
}
