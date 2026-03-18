import { redirect } from "next/navigation";
import { getCurrentSession } from "./session";
import { getRiderProfileByUserId } from "./store";

export async function requireUser() {
  const session = await getCurrentSession();
  if (!session) {
    redirect("/login");
  }

  const riderProfile = getRiderProfileByUserId(session.userId);
  if (!riderProfile) {
    redirect("/login");
  }

  return {
    session,
    riderProfile,
  };
}
