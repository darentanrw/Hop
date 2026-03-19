import Link from "next/link";
import { AdminSimulatorClient } from "../../../components/admin-simulator-client";

export default function AdminSimulatorPage() {
  return (
    <div style={{ paddingTop: 16 }}>
      <div style={{ maxWidth: 1460, margin: "0 auto", width: "100%", padding: "0 20px 6px" }}>
        <Link href="/admin" className="btn btn-ghost" style={{ gap: 6 }}>
          ← Back to overview
        </Link>
      </div>
      <AdminSimulatorClient />
    </div>
  );
}
