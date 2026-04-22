import { defineConfig } from "drizzle-kit";
import path from "path";
import { getMySqlConnectionString } from "./src/mysql-env";

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "mysql",
  dbCredentials: {
    url: getMySqlConnectionString(),
  },
});
