export function resolveAdminRedirect(args: { hasToken: boolean; isAdmin: boolean }) {
  if (!args.hasToken) return "/login";
  if (!args.isAdmin) return "/dashboard";
  return null;
}
