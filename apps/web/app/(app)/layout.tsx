import { BottomNav } from "../../components/bottom-nav";
import { LogoutButton } from "../../components/logout-button";
import { ThemeToggle } from "../../components/theme-toggle";
import { requireUser } from "../../lib/require-user";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { riderProfile } = await requireUser();

  return (
    <>
      <div className="page-container">
        <div className="top-bar">
          <div className="top-bar-brand">
            <div className="hop-logo">H</div>
            <div className="top-bar-info">
              <span className="pseudonym">{riderProfile.pseudonymCode}</span>
              <span className="campus">NUS</span>
            </div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <ThemeToggle />
            <LogoutButton />
          </div>
        </div>
        {children}
      </div>
      <BottomNav />
    </>
  );
}
