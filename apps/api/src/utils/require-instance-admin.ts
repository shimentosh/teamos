import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { isInstanceAdmin } from "./is-instance-admin";

/** Route middleware for settings that belong to the server, not a workspace. */
export async function requireInstanceAdmin(c: Context, next: Next) {
  if (!(await isInstanceAdmin(c))) {
    throw new HTTPException(403, {
      message: "Only the instance admin can change this",
    });
  }
  return next();
}
