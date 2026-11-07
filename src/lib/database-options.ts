import type { PoolConfig } from "pg";
/** Preserve certificate and hostname verification when a provider supplies its own CA. */
export function databaseOptions(
  connectionString: string,
  max = 2,
  ca?: string,
): PoolConfig {
  if (!ca)
    return {
      connectionString,
      max,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 20000,
    };
  const url = new URL(connectionString);
  // pg connection-string SSL parameters replace the explicit ssl object. Remove
  // those parameters so a URL option cannot discard the trusted CA or verification.
  for (const key of [
    "ssl",
    "sslmode",
    "sslcert",
    "sslkey",
    "sslrootcert",
    "sslpassword",
    "sslnegotiation",
  ])
    url.searchParams.delete(key);
  return {
    connectionString: url.toString(),
    max,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 20000,
    ssl: { ca, rejectUnauthorized: true },
  };
}
