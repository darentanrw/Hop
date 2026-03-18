import { cookies } from "next/headers";
import { getSession } from "./store";

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "hop_session";

export async function getCurrentSession() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionId) return null;
  return getSession(sessionId);
}

export { SESSION_COOKIE_NAME };
