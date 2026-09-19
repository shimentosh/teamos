import { eq } from "drizzle-orm";
import db from "../database";
import { instanceSettingTable } from "../database/schema";

export const REGISTRATION_KEY = "auth.disableRegistration";

export type RegistrationOverride = {
  disabled: boolean;
  updatedAt: Date;
  updatedBy: string | null;
};

/** What DISABLE_REGISTRATION says; used until an admin overrides it in-app. */
export function registrationDisabledInEnv(): boolean {
  return process.env.DISABLE_REGISTRATION === "true";
}

export async function readRegistrationOverride(): Promise<RegistrationOverride | null> {
  try {
    const [row] = await db
      .select()
      .from(instanceSettingTable)
      .where(eq(instanceSettingTable.key, REGISTRATION_KEY))
      .limit(1);

    if (!row) return null;

    return {
      disabled: row.value === "true",
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
    };
  } catch (error) {
    // Before migrations run there is no table yet; the environment still decides.
    console.error("Could not read the registration setting", error);
    return null;
  }
}

/**
 * Closing registration is a security decision, so this reads the row on every
 * call instead of caching it: a stale cache would keep sign-ups open after an
 * admin closed them. It is one primary-key lookup.
 */
export async function isRegistrationDisabled(): Promise<boolean> {
  const override = await readRegistrationOverride();
  return override ? override.disabled : registrationDisabledInEnv();
}
