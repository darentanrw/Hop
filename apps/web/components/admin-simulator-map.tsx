"use client";

import {
  PICKUP_ORIGIN_LABEL,
  PICKUP_ORIGIN_LAT,
  PICKUP_ORIGIN_LNG,
  type SimulatorResponse,
} from "@hop/shared";
import { useEffect, useRef, useState } from "react";

type LeafletModule = typeof import("leaflet");

function createPinMarkup(color: string, label: string) {
  return `
    <div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
      <div style="width:18px;height:18px;border-radius:999px;background:${color};border:3px solid white;box-shadow:0 8px 20px rgba(15,23,42,0.28);"></div>
      <div style="padding:4px 8px;border-radius:999px;background:white;border:1px solid rgba(15,23,42,0.1);font:600 11px/1.2 var(--font-body);white-space:nowrap;box-shadow:0 6px 18px rgba(15,23,42,0.12);">
        ${label}
      </div>
    </div>
  `;
}

function createOriginMarkup() {
  return `
    <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
      <div style="width:28px;height:28px;border-radius:999px;background:#0f172a;border:3px solid white;box-shadow:0 8px 24px rgba(15,23,42,0.35);display:flex;align-items:center;justify-content:center;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2L12 22M12 2L6 8M12 2L18 8"/>
        </svg>
      </div>
      <div style="padding:4px 10px;border-radius:999px;background:#0f172a;color:white;font:700 11px/1.2 var(--font-body);white-space:nowrap;box-shadow:0 6px 18px rgba(15,23,42,0.25);letter-spacing:0.03em;">
        UTOWN
      </div>
    </div>
  `;
}

export function AdminSimulatorMap({
  result,
  visibleRiderCount,
}: {
  result: SimulatorResponse | null;
  visibleRiderCount: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerGroupRef = useRef<import("leaflet").LayerGroup | null>(null);
  const leafletRef = useRef<LeafletModule | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function setup() {
      if (!containerRef.current || mapRef.current) return;
      const L = await import("leaflet");
      if (cancelled || !containerRef.current) return;

      leafletRef.current = L;
      const map = L.map(containerRef.current, {
        zoomControl: true,
        scrollWheelZoom: false,
      }).setView([PICKUP_ORIGIN_LAT, PICKUP_ORIGIN_LNG], 12);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);

      layerGroupRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setReady(true);
    }

    void setup();

    return () => {
      cancelled = true;
      layerGroupRef.current?.clearLayers();
      mapRef.current?.remove();
      layerGroupRef.current = null;
      mapRef.current = null;
      leafletRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;

    const L = leafletRef.current;
    const map = mapRef.current;
    const layerGroup = layerGroupRef.current;
    if (!L || !map || !layerGroup) return;
    const leaflet = L;
    const markerLayer = layerGroup;

    layerGroup.clearLayers();

    const bounds = L.latLngBounds([[PICKUP_ORIGIN_LAT, PICKUP_ORIGIN_LNG]]);

    if (!map.getPane("originPane")) {
      const pane = map.createPane("originPane");
      pane.style.zIndex = "700";
    }

    function addOriginMarker() {
      const originIcon = leaflet.divIcon({
        className: "",
        html: createOriginMarkup(),
        iconSize: [100, 60],
        iconAnchor: [50, 30],
      });

      leaflet
        .marker([PICKUP_ORIGIN_LAT, PICKUP_ORIGIN_LNG], {
          icon: originIcon,
          pane: "originPane",
        })
        .bindPopup(PICKUP_ORIGIN_LABEL)
        .addTo(markerLayer);
    }

    if (!result) {
      addOriginMarker();
      map.setView([PICKUP_ORIGIN_LAT, PICKUP_ORIGIN_LNG], 12);
      return;
    }

    const groupColorById = new Map(result.groups.map((group) => [group.groupId, group.color]));
    const visibleRiders = result.riders.slice(0, visibleRiderCount);
    const visibleRiderIds = new Set(visibleRiders.map((r) => r.riderId));

    if (!map.getPane("routePane")) {
      const pane = map.createPane("routePane");
      pane.style.zIndex = "650";
    }

    for (const rider of visibleRiders) {
      bounds.extend([rider.coordinate.lat, rider.coordinate.lng]);
      const color = rider.groupId ? (groupColorById.get(rider.groupId) ?? "#64748b") : "#94a3b8";

      const icon = L.divIcon({
        className: "",
        html: createPinMarkup(color, rider.alias),
        iconSize: [110, 52],
        iconAnchor: [55, 26],
      });

      const groupName = rider.groupId
        ? result.groups.find((g) => g.groupId === rider.groupId)?.name
        : null;
      const lines = [
        `<strong>${rider.alias}</strong>`,
        rider.maskedLocationLabel,
        groupName
          ? `<span style="color:${color}">${groupName}</span> · Dropoff ${rider.dropoffOrder}`
          : "Unmatched",
      ];

      L.marker([rider.coordinate.lat, rider.coordinate.lng], { icon })
        .bindPopup(lines.join("<br />"))
        .addTo(layerGroup);
    }

    for (const group of result.groups) {
      const allMembersVisible = group.members.every((m) => visibleRiderIds.has(m.riderId));
      if (!allMembersVisible) continue;

      for (const leg of group.legs) {
        const coordinates: Array<[number, number]> =
          leg.polyline.length > 0
            ? leg.polyline
            : [
                [leg.from.lat, leg.from.lng],
                [leg.to.lat, leg.to.lng],
              ];
        for (const point of coordinates) {
          bounds.extend(point);
        }

        if (coordinates.length > 0) {
          L.polyline(coordinates, {
            color: "white",
            weight: 8,
            opacity: 0.5,
            lineCap: "round",
            lineJoin: "round",
            pane: "routePane",
          }).addTo(layerGroup);

          L.polyline(coordinates, {
            color: group.color,
            weight: 5,
            opacity: 0.9,
            lineCap: "round",
            lineJoin: "round",
            pane: "routePane",
          }).addTo(layerGroup);
        }
      }
    }

    addOriginMarker();

    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.18));
    }
  }, [result, visibleRiderCount, ready]);

  return <div className="admin-simulator-map-canvas" ref={containerRef} />;
}
