import { ConvexAppProvider } from "../../components/convex-app-provider";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <ConvexAppProvider>{children}</ConvexAppProvider>;
}
