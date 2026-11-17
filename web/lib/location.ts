"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export type Loc = { lat: number; lon: number; acc: number; ts: number };
export type LocState = {
  enabled: boolean;
  loc: Loc | null;
  radius: number;
  status: "off" | "waiting" | "ok" | "denied" | "error" | "unsupported";
  enable: () => void;
  disable: () => void;
  setRadius: (r: number) => void;
};

const KEY = "pk-loc-v1";
// Koordinate se zaokružuju na ~100 m i čuvaju samo na uređaju; serveru se šalju tek uz upit košarice.
const round = (x: number) => Math.round(x * 1000) / 1000;

function distKm(a: Loc, b: { lat: number; lon: number }) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export function useLocation(): LocState {
  const [enabled, setEnabled] = useState(false);
  const [loc, setLoc] = useState<Loc | null>(null);
  const [radius, setRadiusS] = useState(5);
  const [status, setStatus] = useState<LocState["status"]>("off");
  const watch = useRef<number | null>(null);

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) ?? "null");
      if (s) { setEnabled(!!s.enabled); setRadiusS(s.radius ?? 5); if (s.loc) setLoc(s.loc); }
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ enabled, radius, loc })); } catch {}
  }, [enabled, radius, loc]);

  // praćenje lokacije dok je uključeno; nova pozicija tek kad se pomakneš > 300 m
  useEffect(() => {
    if (!enabled) return;
    if (!("geolocation" in navigator)) { setStatus("unsupported"); return; }
    setStatus((s) => (s === "ok" ? s : "waiting"));
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        const n: Loc = { lat: round(p.coords.latitude), lon: round(p.coords.longitude), acc: Math.round(p.coords.accuracy), ts: Date.now() };
        setLoc((o) => (o && distKm(o, n) < 0.3 ? o : n));
        setStatus("ok");
      },
      (e) => setStatus(e.code === e.PERMISSION_DENIED ? "denied" : "error"),
      { enableHighAccuracy: false, maximumAge: 5 * 60_000, timeout: 20_000 },
    );
    return () => { if (watch.current != null) navigator.geolocation.clearWatch(watch.current); };
  }, [enabled]);

  const enable = useCallback(() => setEnabled(true), []);
  const disable = useCallback(() => { setEnabled(false); setStatus("off"); setLoc(null); }, []);
  const setRadius = useCallback((r: number) => setRadiusS(r), []);
  return { enabled, loc: enabled ? loc : null, radius, status: enabled ? status : "off", enable, disable, setRadius };
}

export const mapsUrl = (lat: number, lon: number) =>
  `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
export const directionsUrl = (lat: number, lon: number) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
