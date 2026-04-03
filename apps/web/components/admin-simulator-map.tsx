"use client";

import {
  PICKUP_ORIGIN_LABEL,
  PICKUP_ORIGIN_LAT,
  PICKUP_ORIGIN_LNG,
  type SimulatorSession,
} from "@hop/shared";
import { useEffect, useRef, useState } from "react";

type LeafletModule = typeof import("leaflet");
type SimulatorFilter = "all" | "matched" | "open";

function createPinMarkup(color: string, label: string, scale = 1, opacity = 1) {
  return `
    <div style="display:flex;flex-direction:column;align-items:center;gap:6px;opacity:${opacity};transform:scale(${scale});transform-origin:center center;transition:transform 120ms ease, opacity 120ms ease;">
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
  session,
  filter,
  highlightedGroupId,
}: {
  session: SimulatorSession;
  filter: SimulatorFilter;
  highlightedGroupId: string | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerGroupRef = useRef<import("leaflet").LayerGroup | null>(null);
  const leafletRef = useRef<LeafletModule | null>(null);
  const previousViewStateRef = useRef<{
    session: SimulatorSession | null;
    filter: SimulatorFilter | null;
  }>({
    session: null,
    filter: null,
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let cleanupWheelListener: (() => void) | null = null;

    async function setup() {
      if (!containerRef.current || mapRef.current) return;
      const L = await import("leaflet");
      if (cancelled || !containerRef.current) return;

      leafletRef.current = L;
      const map = L.map(containerRef.current, {
        zoomControl: true,
        dragging: true,
        scrollWheelZoom: true,
        touchZoom: true,
        doubleClickZoom: true,
        boxZoom: true,
        keyboard: true,
      }).setView([PICKUP_ORIGIN_LAT, PICKUP_ORIGIN_LNG], 12);
      map.scrollWheelZoom.enable();

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);

      const handleWheel = (event: WheelEvent) => {
        event.preventDefault();
      };
      containerRef.current.addEventListener("wheel", handleWheel, { passive: false });
      cleanupWheelListener = () => {
        containerRef.current?.removeEventListener("wheel", handleWheel);
      };

      layerGroupRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setReady(true);
    }

    void setup();

    return () => {
      cancelled = true;
      cleanupWheelListener?.();
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

    layerGroup.clearLayers();
    const bounds = L.latLngBounds([[PICKUP_ORIGIN_LAT, PICKUP_ORIGIN_LNG]]);
    const shouldRefit =
      previousViewStateRef.current.session !== session ||
      previousViewStateRef.current.filter !== filter;
    previousViewStateRef.current = { session, filter };

    if (!map.getPane("originPane")) {
      const pane = map.createPane("originPane");
      pane.style.zIndex = "700";
    }

    if (!map.getPane("routePane")) {
      const pane = map.createPane("routePane");
      pane.style.zIndex = "650";
    }

    const ridersToShow = session.riders.filter((rider) => {
      if (!rider.coordinate) return false;
      if (filter === "matched") return rider.state === "matched";
      if (filter === "open") return rider.state !== "matched";
      return true;
    });
    const visibleRiderIds = new Set(ridersToShow.map((rider) => rider.id));
    const highlightedGroup = highlightedGroupId
      ? (session.groups.find((group) => group.groupId === highlightedGroupId) ?? null)
      : null;
    const highlightedRiderIds = new Set(highlightedGroup?.memberRiderIds ?? []);

    for (const rider of ridersToShow) {
      if (!rider.coordinate) continue;
      bounds.extend([rider.coordinate.lat, rider.coordinate.lng]);

      const color = rider.state === "matched" ? (rider.color ?? "#64748b") : "#94a3b8";
      const isHighlighted = highlightedRiderIds.has(rider.id);
      const isDimmed = highlightedRiderIds.size > 0 && !isHighlighted;
      const icon = L.divIcon({
        className: "",
        html: createPinMarkup(color, rider.label, isHighlighted ? 1.08 : 1, isDimmed ? 0.3 : 1),
        iconSize: [110, 52],
        iconAnchor: [55, 26],
      });

      const lines = [
        `<strong>${rider.label}</strong>`,
        rider.maskedLocationLabel ?? "Awaiting first preview run",
        rider.state === "matched"
          ? `<span style="color:${color}">${rider.color ? "Matched" : "Matched"}</span> · Dropoff ${rider.dropoffOrder ?? "?"}`
          : rider.state === "open"
            ? "Carry-over unmatched"
            : "New this run",
      ];

      L.marker([rider.coordinate.lat, rider.coordinate.lng], { icon })
        .bindPopup(lines.join("<br />"))
        .addTo(layerGroup);
    }

    if (filter !== "open") {
      for (const group of session.groups) {
        const allMembersVisible = group.memberRiderIds.every((riderId) =>
          visibleRiderIds.has(riderId),
        );
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
              weight: group.groupId === highlightedGroupId ? 9 : 8,
              opacity:
                highlightedGroupId == null
                  ? 0.5
                  : group.groupId === highlightedGroupId
                    ? 0.7
                    : 0.14,
              lineCap: "round",
              lineJoin: "round",
              pane: "routePane",
            }).addTo(layerGroup);

            L.polyline(coordinates, {
              color: group.color,
              weight: highlightedGroupId == null ? 5 : group.groupId === highlightedGroupId ? 7 : 3,
              opacity:
                highlightedGroupId == null ? 0.9 : group.groupId === highlightedGroupId ? 1 : 0.2,
              lineCap: "round",
              lineJoin: "round",
              pane: "routePane",
            }).addTo(layerGroup);
          }
        }
      }
    }

    const originIcon = L.divIcon({
      className: "",
      html: createOriginMarkup(),
      iconSize: [100, 60],
      iconAnchor: [50, 30],
    });

    L.marker([PICKUP_ORIGIN_LAT, PICKUP_ORIGIN_LNG], {
      icon: originIcon,
      pane: "originPane",
    })
      .bindPopup(PICKUP_ORIGIN_LABEL)
      .addTo(layerGroup);

    if (shouldRefit && bounds.isValid()) {
      map.fitBounds(bounds.pad(0.18));
    } else if (shouldRefit) {
      map.setView([PICKUP_ORIGIN_LAT, PICKUP_ORIGIN_LNG], 12);
    }
  }, [filter, highlightedGroupId, ready, session]);

  return <div className="admin-simulator-map-canvas" ref={containerRef} />;
}
