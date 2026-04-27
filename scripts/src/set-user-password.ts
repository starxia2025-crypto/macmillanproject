import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";

function parseArgs(argv: string[]) {
  const args = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args.set(key, "true");
      continue;
    }

    args.set(key, next);
    index += 1;
  }

  const email = (args.get("email") || "").trim().toLowerCase();
  const password = (args.get("password") || "").trim();
  const activate = args.get("activate") !== "false";
  const forceChange = args.get("force-change") !== "false";

  if (!email) {
    throw new Error("Falta --email. Ejemplo: --email usuario@centro.es");
  }

  if (!password || password.length < 12) {
    throw new Error("Falta --password o tiene menos de 12 caracteres.");
  }

  return { email, password, activate, forceChange };
}

async function main() {
  const { email, password, activate, forceChange } = parseArgs(process.argv.slice(2));

  const existingUsers = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      active: usersTable.active,
    })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  const user = existingUsers[0];
  if (!user) {
    throw new Error(`No existe ningun usuario con email ${email}.`);
  }

  await db
    .update(usersTable)
    .set({
      passwordHash: await bcrypt.hash(password, 12),
      active: activate ? true : user.active,
      mustChangePassword: forceChange,
      failedLoginAttempts: 0,
      lockedUntil: null,
      resetPasswordTokenHash: null,
      resetPasswordExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, user.id));

  console.log(`Password actualizada para ${email}.`);
  console.log(`active=${activate ? "true" : String(user.active)}`);
  console.log(`mustChangePassword=${forceChange ? "true" : "false"}`);
  console.log("failedLoginAttempts=0");
  console.log("lockedUntil=null");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
