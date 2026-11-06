import { hash, verify } from "@node-rs/argon2";

// Argon2id with the library's defaults (OWASP-recommended memory and time cost).
export const hashPassword = (password: string) => hash(password);

let dummy: Promise<string> | null = null;

/**
 * Always runs one Argon2 verification, even for unknown emails, so response time
 * doesn't reveal which emails have accounts.
 */
export async function verifyPassword(storedHash: string | null, password: string): Promise<boolean> {
  if (storedHash) return verify(storedHash, password).catch(() => false);
  dummy ??= hash("offgrid-timing-equaliser");
  await verify(await dummy, password).catch(() => false);
  return false;
}
