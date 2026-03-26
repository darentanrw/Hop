import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";
import { NextResponse } from "next/server";

const isLoginPage = createRouteMatcher(["/login"]);
const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/availability(.*)",
  "/group(.*)",
  "/profile(.*)",
  "/admin(.*)",
  "/verify-email",
  "/onboarding",
]);

export default convexAuthNextjsMiddleware(
  async (request, { convexAuth }) => {
    const authenticated = await convexAuth.isAuthenticated();

    // Only redirect away from /login when authenticated. Let verify-email and onboarding
    // through so users can complete those steps (layout will redirect if already done).
    if (isLoginPage(request) && authenticated) {
      return nextjsMiddlewareRedirect(request, "/dashboard");
    }

    if (isProtectedRoute(request) && !authenticated) {
      return nextjsMiddlewareRedirect(request, "/login");
    }

    return NextResponse.next();
  },
  {
    cookieConfig: { maxAge: 60 * 60 * 24 * 7 },
  },
);

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
