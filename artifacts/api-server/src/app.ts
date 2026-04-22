import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import fs from "node:fs";
import path from "node:path";
import router from "./routes";
import { logger } from "./lib/logger";
import { ensureUserPasswordFlagColumn } from "./lib/schema-ensure";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: true, limit: "12mb" }));
app.use("/uploads", express.static(path.resolve(process.env["DOCUMENTS_STORAGE_ROOT"] || "/app/storage")));

app.use(async (_req, res, next) => {
  try {
    await ensureUserPasswordFlagColumn();
    next();
  } catch (error) {
    logger.error({ err: error }, "Error ensuring database schema");
    res.status(500).json({ error: "InternalServerError", message: "No se pudo verificar la base de datos." });
  }
});

app.use("/api", router);

const staticDir = process.env["STATIC_DIR"];
if (staticDir) {
  const resolvedStaticDir = path.resolve(staticDir);
  const indexHtmlPath = path.join(resolvedStaticDir, "index.html");

  if (fs.existsSync(indexHtmlPath)) {
    app.use(express.static(resolvedStaticDir));
    app.use((req, res, next) => {
      if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) {
        next();
        return;
      }

      res.sendFile(indexHtmlPath);
    });
  }
}

export default app;
