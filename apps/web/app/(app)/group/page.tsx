import { GroupClient } from "../../../components/group-client";
import { runMatching } from "../../../lib/matching";
import { requireUser } from "../../../lib/require-user";
import { findActiveGroupForRider } from "../../../lib/store";

export default async function GroupPage() {
  const { riderProfile } = await requireUser();
  await runMatching();
  const current = findActiveGroupForRider(riderProfile.riderId);

  return (
    <div className="stack-lg stagger">
      <div style={{ paddingTop: 4 }}>
        <h1>Your group</h1>
        <p style={{ marginTop: 6 }}>Addresses revealed only after everyone confirms.</p>
      </div>
      <GroupClient initialGroup={current} />
    </div>
  );
}
