import type { PoolOptions } from "mysql2/promise";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set for MySQL connectivity.`);
  }
  return value;
}

function optionalNumber(name: string, fallback: number): number {
  const rawValue = process.env[name]?.trim();
  if (!rawValue) return fallback;

  const parsed = Number(rawValue);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }

  return parsed;
}

function parseDatabaseUrl(url: string): PoolOptions {
  const parsed = new URL(url);
  const protocol = parsed.protocol.replace(/:$/, "");

  if (protocol !== "mysql" && protocol !== "mysql2") {
    throw new Error(`DATABASE_URL must use a MySQL protocol, received "${parsed.protocol}".`);
  }

  const database = parsed.pathname.replace(/^\/+/, "");
  if (!database) {
    throw new Error("DATABASE_URL must include a database name.");
  }

  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
  };
}

export function getMySqlConfig(): PoolOptions {
  const databaseUrl = process.env["DATABASE_URL"]?.trim();
  const baseConfig = databaseUrl
    ? parseDatabaseUrl(databaseUrl)
    : {
        host: required("MYSQL_HOST"),
        port: optionalNumber("MYSQL_PORT", 3306),
        user: required("MYSQL_USER"),
        password: required("MYSQL_PASSWORD"),
        database: required("MYSQL_DATABASE"),
      };

  return {
    ...baseConfig,
    waitForConnections: true,
    connectionLimit: optionalNumber("MYSQL_CONNECTION_LIMIT", 10),
    queueLimit: 0,
    timezone: "Z",
    charset: process.env["MYSQL_CHARSET"]?.trim() || "utf8mb4",
  };
}

export function getMySqlConnectionString() {
  const databaseUrl = process.env["DATABASE_URL"]?.trim();
  if (databaseUrl) return databaseUrl;

  const config = getMySqlConfig();
  const user = encodeURIComponent(String(config.user ?? ""));
  const password = encodeURIComponent(String(config.password ?? ""));
  const host = String(config.host ?? "localhost");
  const port = Number(config.port ?? 3306);
  const database = encodeURIComponent(String(config.database ?? ""));

  return `mysql://${user}:${password}@${host}:${port}/${database}`;
}
