import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SuspendedSignOut } from "../../../components/suspended-sign-out";
import { api } from "../../../convex/_generated/api";

export default async function SuspendedPage() {
  const token = await convexAuthNextjsToken();
  if (!token) redirect("/login");

  const riderProfile = await fetchQuery(api.queries.getRiderProfile, {}, { token });
  if (!riderProfile) redirect("/onboarding");

  const adminAccess = await fetchQuery(api.admin.adminAccess, {}, { token });
  if (adminAccess.isAdmin) redirect("/dashboard");
  if (!riderProfile.credibilitySuspended) redirect("/dashboard");

  return (
    <div className="auth-page">
      <div className="auth-header">
        <h1>Account suspended</h1>
        <p style={{ marginTop: 8 }}>
          Your credibility score is too low to use Hop right now. If you think this is a mistake,
          contact support.
        </p>
      </div>
      <div className="auth-body">
        <div className="card stack" style={{ textAlign: "center", padding: 24 }}>
          <SuspendedSignOut />
          <Link href="/login" className="btn btn-ghost btn-sm" style={{ marginTop: 12 }}>
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
