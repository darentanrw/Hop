import type { CompatibilityEdge, SelfDeclaredGender } from "./domain";

export type Coordinate = {
  lat: number;
  lng: number;
};

export type SimulatorInputRider = {
  label: string;
  address: string;
  windowStart: string;
  windowEnd: string;
  selfDeclaredGender: SelfDeclaredGender;
  sameGenderOnly: boolean;
};

export type SimulatorRequest = {
  riders: SimulatorInputRider[];
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

export type SimulatorCompatibilityEdge = CompatibilityEdge & {
  leftRiderId: string;
  rightRiderId: string;
  leftAlias: string;
  rightAlias: string;
};

export type SimulatorRiderResult = {
  riderId: string;
  alias: string;
  maskedLocationLabel: string;
  coordinate: Coordinate;
  routeDescriptorRef: string;
  sealedDestinationRef: string;
  clusterKey: string | null;
  groupId: string | null;
  color: string | null;
  dropoffOrder: number | null;
};

export type SimulatorGroupResult = {
  groupId: string;
  name: string;
  color: string;
  members: SimulatorRiderResult[];
  averageScore: number;
  minimumScore: number;
  maxDetourMinutes: number;
  totalDistanceMeters: number;
  totalTimeSeconds: number;
  legs: SimulatorRouteLeg[];
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

export type SimulatorResponse = {
  riders: SimulatorRiderResult[];
  groups: SimulatorGroupResult[];
  unmatchedRiderIds: string[];
  compatibilityEdges: SimulatorCompatibilityEdge[];
  stats: SimulatorStats;
};
