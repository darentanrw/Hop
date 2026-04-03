import type { CompatibilityEdge, SelfDeclaredGender } from "./domain";

export type Coordinate = {
  lat: number;
  lng: number;
};

export type SimulatorInputRider = {
  label: string;
  address: string;
  verifiedTitle?: string | null;
  postal?: string | null;
  windowStart: string;
  windowEnd: string;
  selfDeclaredGender: SelfDeclaredGender;
  sameGenderOnly: boolean;
};

export type SimulatorPreviewRiderRequest = {
  riderId: string;
  routeDescriptorRef: string;
  sealedDestinationRef: string;
  alias: string;
};

export type SimulatorPreviewGroupRequest = {
  groupId: string;
  members: SimulatorPreviewRiderRequest[];
};

export type MatcherSimulatorPreviewRequest = {
  riders: SimulatorPreviewRiderRequest[];
  groups: SimulatorPreviewGroupRequest[];
};

export type SimulatorRouteLeg = {
  fromLabel: string;
  toLabel: string;
  from: Coordinate;
  to: Coordinate;
  polyline: Array<[number, number]>;
  distanceMeters: number;
  timeSeconds: number;
};

export type MatcherSimulatorPreviewRider = {
  riderId: string;
  routeDescriptorRef: string;
  sealedDestinationRef: string;
  alias: string;
  maskedLocationLabel: string;
  coordinate: Coordinate;
};

export type MatcherSimulatorPreviewGroup = {
  groupId: string;
  legs: SimulatorRouteLeg[];
  totalDistanceMeters: number;
  totalTimeSeconds: number;
};

export type MatcherSimulatorPreviewResponse = {
  riders: MatcherSimulatorPreviewRider[];
  groups: MatcherSimulatorPreviewGroup[];
};

export type SimulatorSessionRiderState = "new" | "open" | "matched";

export type SimulatorSessionRider = {
  id: string;
  label: string;
  arrivalIndex: number;
  address: string;
  verifiedTitle: string | null;
  postal: string | null;
  windowStart: string;
  windowEnd: string;
  selfDeclaredGender: SelfDeclaredGender;
  sameGenderOnly: boolean;
  sealedDestinationRef: string;
  routeDescriptorRef: string;
  state: SimulatorSessionRiderState;
  lastProcessedCycleNumber: number | null;
  matchedGroupId: string | null;
  maskedLocationLabel: string | null;
  coordinate: Coordinate | null;
  clusterKey: string | null;
  color: string | null;
  dropoffOrder: number | null;
};

export type SimulatorSessionGroup = {
  groupId: string;
  memberRiderIds: string[];
  name: string;
  color: string;
  averageScore: number;
  minimumScore: number;
  maxDetourMinutes: number;
  totalDistanceMeters: number;
  totalTimeSeconds: number;
  legs: SimulatorRouteLeg[];
};

export type SimulatorSession = {
  sessionSeed: number;
  nextArrivalIndex: number;
  nextCycleNumber: number;
  riders: SimulatorSessionRider[];
  groups: SimulatorSessionGroup[];
  openRiderIds: string[];
};

export type SimulatorRunRequest = {
  session: SimulatorSession;
};

export type SimulatorCycleAssignment = {
  cycleNumber: number;
  riderIds: string[];
};

export type SimulatorCompatibilityEdge = CompatibilityEdge & {
  leftRiderId: string;
  rightRiderId: string;
  leftAlias: string;
  rightAlias: string;
  cycleNumber: number;
};

export type SimulatorStats = {
  totalRiders: number;
  groupsFormed: number;
  matchedRiders: number;
  unmatchedRiders: number;
  compatiblePairCount: number;
  averagePairScore: number;
  minimumPairScore: number;
  totalRouteDistanceMeters: number;
  totalRouteTimeSeconds: number;
  totalGroupDetourMinutes: number;
};

export type SimulatorRunResponse = {
  session: SimulatorSession;
  cycleAssignments: SimulatorCycleAssignment[];
  compatibilityEdges: SimulatorCompatibilityEdge[];
  stats: SimulatorStats;
};
