import "leaflet/dist/leaflet.css";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { redirect } from "next/navigation";
import { ConvexAppProvider } from "../../components/convex-app-provider";
import { api } from "../../convex/_generated/api";
import { resolveAdminRedirect } from "../../lib/admin-guard";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const token = await convexAuthNextjsToken();
  const access = token
    ? await fetchQuery(api.admin.adminAccess, {}, { token })
    : { isAdmin: false };
  const redirectPath = resolveAdminRedirect({
    hasToken: Boolean(token),
    isAdmin: access.isAdmin === true,
  });

  if (redirectPath) {
    redirect(redirectPath);
  }

  return <ConvexAppProvider>{children}</ConvexAppProvider>;
}
