import { drizzle } from "drizzle-orm/mysql2";
import { createPool } from "mysql2/promise";
import * as schema from "./schema";
import { getMySqlConfig } from "./mysql-env";

const mySqlConfig = getMySqlConfig();

export const pool = createPool(mySqlConfig);
export const db = drizzle({ client: pool, schema, mode: "default" });

export * from "./schema";
