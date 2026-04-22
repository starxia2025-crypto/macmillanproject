import { pool } from "@workspace/db";

type ColumnCountRow = {
  count: number | string;
};

let ensureUserPasswordFlagPromise: Promise<void> | null = null;

export function ensureUserPasswordFlagColumn() {
  if (!ensureUserPasswordFlagPromise) {
    ensureUserPasswordFlagPromise = (async () => {
      const columnsToEnsure = [
        {
          name: "must_change_password",
          ddl: "ALTER TABLE SOP_users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE",
        },
        {
          name: "failed_login_attempts",
          ddl: "ALTER TABLE SOP_users ADD COLUMN failed_login_attempts INT NOT NULL DEFAULT 0",
        },
        {
          name: "locked_until",
          ddl: "ALTER TABLE SOP_users ADD COLUMN locked_until DATETIME(3) NULL",
        },
        {
          name: "reset_password_token_hash",
          ddl: "ALTER TABLE SOP_users ADD COLUMN reset_password_token_hash VARCHAR(255) NULL",
        },
        {
          name: "reset_password_expires_at",
          ddl: "ALTER TABLE SOP_users ADD COLUMN reset_password_expires_at DATETIME(3) NULL",
        },
        {
          name: "last_login_at",
          ddl: "ALTER TABLE SOP_users ADD COLUMN last_login_at DATETIME(3) NULL",
        },
      ] as const;

      for (const column of columnsToEnsure) {
        const [rows] = await pool.query(
          `
            SELECT COUNT(*) AS count
            FROM information_schema.columns
            WHERE table_schema = DATABASE()
              AND table_name = 'SOP_users'
              AND column_name = ?
          `,
          [column.name],
        );

        if (!Number((rows as ColumnCountRow[])[0]?.count ?? 0)) {
          await pool.query(column.ddl);
        }
      }
    })();
  }

  return ensureUserPasswordFlagPromise;
}
