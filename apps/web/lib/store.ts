import crypto from "node:crypto";
import type {
  AddressEnvelope,
  AvailabilityEntry,
  GroupSummaryResponse,
  RiderProfile,
  SelfDeclaredGender,
  TentativeGroup,
  TentativeGroupMember,
} from "@hop/shared";

type UserRecord = {
  id: string;
  email: string;
  emailDomain: string;
  status: "active";
  verifiedAt: string | null;
};

type OtpRequestRecord = {
  id: string;
  email: string;
  emailDomain: string;
  codeHash: string;
  expiresAt: string;
  consumedAt: string | null;
};

type SessionRecord = {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
};

type ClientKeyRecord = {
  id: string;
  userId: string;
  publicKey: string;
  createdAt: string;
  revokedAt: string | null;
};

type RiderRecord = {
  id: string;
  userId: string;
  pseudonymCode: string;
  createdAt: string;
};

type PreferenceRecord = {
  riderId: string;
  selfDeclaredGender: SelfDeclaredGender;
  sameGenderOnly: boolean;
  minGroupSize: number;
  maxGroupSize: number;
};

type GroupRecord = TentativeGroup & {
  availabilityIds: string[];
  memberRiderIds: string[];
  envelopesByRecipient: Record<string, AddressEnvelope[]>;
};

type AuditRecord = {
  id: string;
  action: string;
  actorId: string;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
};

type MemoryStore = {
  users: Map<string, UserRecord>;
  otpRequests: Map<string, OtpRequestRecord>;
  sessions: Map<string, SessionRecord>;
  clientKeys: Map<string, ClientKeyRecord>;
  riders: Map<string, RiderRecord>;
  preferences: Map<string, PreferenceRecord>;
  availabilities: Map<string, AvailabilityEntry>;
  groups: Map<string, GroupRecord>;
  groupMembers: Map<string, TentativeGroupMember[]>;
  auditEvents: AuditRecord[];
};

const globalStore = globalThis as typeof globalThis & { __hopMemoryStore?: MemoryStore };

export function getStore(): MemoryStore {
  if (!globalStore.__hopMemoryStore) {
    globalStore.__hopMemoryStore = {
      users: new Map(),
      otpRequests: new Map(),
      sessions: new Map(),
      clientKeys: new Map(),
      riders: new Map(),
      preferences: new Map(),
      availabilities: new Map(),
      groups: new Map(),
      groupMembers: new Map(),
      auditEvents: [],
    };
  }

  return globalStore.__hopMemoryStore;
}

export function nowIso() {
  return new Date().toISOString();
}

export function futureIso(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export function sha256(text: string) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function createOtpRequest(email: string, emailDomain: string, code: string) {
  const store = getStore();
  const request: OtpRequestRecord = {
    id: crypto.randomUUID(),
    email,
    emailDomain,
    codeHash: sha256(code),
    expiresAt: futureIso(10),
    consumedAt: null,
  };
  store.otpRequests.set(request.id, request);
  return request;
}

export function getOtpRequest(id: string) {
  return getStore().otpRequests.get(id) ?? null;
}

export function consumeOtpRequest(id: string) {
  const request = getStore().otpRequests.get(id);
  if (request) {
    request.consumedAt = nowIso();
  }
}

export function findUserByEmail(email: string) {
  return [...getStore().users.values()].find((user) => user.email === email) ?? null;
}

export function upsertUser(email: string, emailDomain: string) {
  const existing = findUserByEmail(email);
  if (existing) {
    existing.verifiedAt = nowIso();
    return existing;
  }

  const user: UserRecord = {
    id: crypto.randomUUID(),
    email,
    emailDomain,
    status: "active",
    verifiedAt: nowIso(),
  };
  getStore().users.set(user.id, user);
  return user;
}

export function ensureRiderForUser(userId: string) {
  const store = getStore();
  const existing = [...store.riders.values()].find((rider) => rider.userId === userId);
  if (existing) return existing;

  const pseudonymCode = `Rider ${String.fromCharCode(65 + (store.riders.size % 26))}`;
  const rider: RiderRecord = {
    id: crypto.randomUUID(),
    userId,
    pseudonymCode,
    createdAt: nowIso(),
  };
  store.riders.set(rider.id, rider);
  store.preferences.set(rider.id, {
    riderId: rider.id,
    selfDeclaredGender: "prefer_not_to_say",
    sameGenderOnly: false,
    minGroupSize: 2,
    maxGroupSize: 4,
  });
  return rider;
}

export function registerClientKey(userId: string, publicKey: string) {
  const store = getStore();
  const existing = [...store.clientKeys.values()].find(
    (key) => key.userId === userId && key.publicKey === publicKey && key.revokedAt === null,
  );

  if (existing) return existing;

  const key: ClientKeyRecord = {
    id: crypto.randomUUID(),
    userId,
    publicKey,
    createdAt: nowIso(),
    revokedAt: null,
  };
  store.clientKeys.set(key.id, key);
  return key;
}

export function getActiveClientKeyForUser(userId: string) {
  return (
    [...getStore().clientKeys.values()].find(
      (key) => key.userId === userId && key.revokedAt === null,
    ) ?? null
  );
}

export function createSession(userId: string) {
  const session: SessionRecord = {
    id: crypto.randomUUID(),
    userId,
    createdAt: nowIso(),
    expiresAt: futureIso(60 * 24 * 7),
  };
  getStore().sessions.set(session.id, session);
  return session;
}

export function getSession(sessionId: string) {
  const session = getStore().sessions.get(sessionId) ?? null;
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    getStore().sessions.delete(sessionId);
    return null;
  }
  return session;
}

export function destroySession(sessionId: string) {
  getStore().sessions.delete(sessionId);
}

export function getRiderProfileByUserId(userId: string): RiderProfile | null {
  const store = getStore();
  const rider = [...store.riders.values()].find((entry) => entry.userId === userId);
  if (!rider) return null;
  const preference = store.preferences.get(rider.id);
  if (!preference) return null;

  return {
    riderId: rider.id,
    pseudonymCode: rider.pseudonymCode,
    selfDeclaredGender: preference.selfDeclaredGender,
    sameGenderOnly: preference.sameGenderOnly,
    minGroupSize: preference.minGroupSize,
    maxGroupSize: preference.maxGroupSize,
  };
}

export function updatePreferences(
  riderId: string,
  next: Partial<PreferenceRecord>,
): RiderProfile | null {
  const store = getStore();
  const preference = store.preferences.get(riderId);
  const rider = store.riders.get(riderId);
  if (!preference || !rider) return null;

  Object.assign(preference, next);

  return {
    riderId: rider.id,
    pseudonymCode: rider.pseudonymCode,
    selfDeclaredGender: preference.selfDeclaredGender,
    sameGenderOnly: preference.sameGenderOnly,
    minGroupSize: preference.minGroupSize,
    maxGroupSize: preference.maxGroupSize,
  };
}

export function createAvailability(entry: Omit<AvailabilityEntry, "id" | "createdAt" | "status">) {
  const store = getStore();
  for (const availability of store.availabilities.values()) {
    if (availability.riderId !== entry.riderId || availability.status !== "open") continue;

    const overlap =
      new Date(entry.windowStart).getTime() < new Date(availability.windowEnd).getTime() &&
      new Date(entry.windowEnd).getTime() > new Date(availability.windowStart).getTime();

    if (overlap) {
      availability.status = "cancelled";
    }
  }

  const availability: AvailabilityEntry = {
    id: crypto.randomUUID(),
    createdAt: nowIso(),
    status: "open",
    ...entry,
  };
  store.availabilities.set(availability.id, availability);
  return availability;
}

export function listAvailabilitiesForRider(riderId: string) {
  return [...getStore().availabilities.values()].filter((entry) => entry.riderId === riderId);
}

export function cancelAvailability(availabilityId: string, riderId: string) {
  const availability = getStore().availabilities.get(availabilityId);
  if (!availability || availability.riderId !== riderId) return null;
  availability.status = "cancelled";
  return availability;
}

export function listOpenAvailabilities() {
  return [...getStore().availabilities.values()].filter((entry) => entry.status === "open");
}

export function markAvailabilityMatched(ids: string[]) {
  for (const id of ids) {
    const availability = getStore().availabilities.get(id);
    if (availability) availability.status = "matched";
  }
}

export function reopenAvailabilities(ids: string[]) {
  for (const id of ids) {
    const availability = getStore().availabilities.get(id);
    if (availability && availability.status === "matched") availability.status = "open";
  }
}

export function createGroup(
  group: Omit<GroupRecord, "id" | "createdAt" | "revealedAt" | "envelopesByRecipient">,
) {
  const record: GroupRecord = {
    ...group,
    id: crypto.randomUUID(),
    createdAt: nowIso(),
    revealedAt: null,
    envelopesByRecipient: {},
  };
  getStore().groups.set(record.id, record);
  return record;
}

export function setGroupMembers(groupId: string, members: TentativeGroupMember[]) {
  getStore().groupMembers.set(groupId, members);
}

export function listGroupMembers(groupId: string) {
  return getStore().groupMembers.get(groupId) ?? [];
}

export function getGroup(groupId: string) {
  return getStore().groups.get(groupId) ?? null;
}

export function findActiveGroupForRider(riderId: string): GroupSummaryResponse | null {
  const store = getStore();
  const group = [...store.groups.values()].find(
    (entry) => entry.status !== "dissolved" && entry.memberRiderIds.includes(riderId),
  );
  if (!group) return null;
  const members = store.groupMembers.get(group.id) ?? [];
  return {
    group,
    members,
    revealReady: members.length > 0 && members.every((member) => member.accepted === true),
  };
}

export function updateAcknowledgement(groupId: string, riderId: string, accepted: boolean) {
  const members = listGroupMembers(groupId);
  const member = members.find((entry) => entry.riderId === riderId);
  if (!member) return null;

  member.accepted = accepted;
  member.acknowledgedAt = nowIso();

  return member;
}

export function dissolveGroup(groupId: string) {
  const group = getStore().groups.get(groupId);
  if (!group) return;
  group.status = "dissolved";
  reopenAvailabilities(group.availabilityIds);
}

export function revealGroup(
  groupId: string,
  envelopesByRecipient: Record<string, AddressEnvelope[]>,
) {
  const group = getStore().groups.get(groupId);
  if (!group) return null;
  group.status = "revealed";
  group.revealedAt = nowIso();
  group.envelopesByRecipient = envelopesByRecipient;
  return group;
}

export function getEnvelopesForRecipient(groupId: string, riderId: string) {
  return getStore().groups.get(groupId)?.envelopesByRecipient[riderId] ?? [];
}

export function recordAudit(action: string, actorId: string, metadata: AuditRecord["metadata"]) {
  getStore().auditEvents.push({
    id: crypto.randomUUID(),
    action,
    actorId,
    metadata,
    createdAt: nowIso(),
  });
}

export function adminSnapshot() {
  const store = getStore();
  return {
    users: store.users.size,
    riders: store.riders.size,
    openAvailabilities: [...store.availabilities.values()].filter(
      (entry) => entry.status === "open",
    ).length,
    tentativeGroups: [...store.groups.values()].filter((entry) => entry.status === "tentative")
      .length,
    revealedGroups: [...store.groups.values()].filter((entry) => entry.status === "revealed")
      .length,
    auditEvents: store.auditEvents.slice(-20).reverse(),
  };
}
