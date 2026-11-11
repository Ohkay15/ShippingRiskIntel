"use client";

import { useEffect, useMemo, useState } from "react";

import type { RouteConditions } from "@/conditions/service";

import { LaneMap, type MapEndpoint, type MapLane } from "./lane-map";

/**
 * "Route conditions" card on a shipment: the lane on a map with live radar,
 * active weather alerts along it, and recent news about its endpoints.
 * Loads after the page so a slow public feed never delays the record.
 */

const SEVERITY_TONE: Record<string, string> = {
  Extreme: "danger",
  Severe: "danger",
  Moderate: "warn",
  Minor: "muted",
  Unknown: "muted",
};

export function relativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return "";
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const unit =
    mins < 60 ? `${mins} min` : mins < 60 * 36 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} d`;
  return diff >= 0 ? `in ${unit}` : `${unit} ago`;
}

function miles(km: number): string {
  return `${Math.round(km * 0.621371).toLocaleString("en-US")} mi`;
}

export function RouteConditionsPanel({ shipmentId, tone }: { shipmentId: string; tone: MapLane["tone"] }) {
  const [data, setData] = useState<RouteConditions | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/conditions/shipment/${shipmentId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Couldn't load conditions.");
        return res.json() as Promise<RouteConditions>;
      })
      .then((d) => !cancelled && setData(d))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load conditions."));
    return () => {
      cancelled = true;
    };
  }, [shipmentId]);

  const lanes = useMemo<MapLane[]>(
    () =>
      data?.route
        ? [{ id: shipmentId, label: "", path: data.route.path, tone, approximate: data.route.approximate, emphasis: true }]
        : [],
    [data, shipmentId, tone]
  );
  const endpoints = useMemo<MapEndpoint[]>(() => {
    const out: MapEndpoint[] = [];
    if (data?.origin) out.push({ at: [data.origin.lon, data.origin.lat], label: data.origin.name, kind: "origin" });
    if (data?.destination)
      out.push({ at: [data.destination.lon, data.destination.lat], label: data.destination.name, kind: "destination" });
    return out;
  }, [data]);

  const placed = Boolean(data?.origin || data?.destination);

  return (
    <section className="document-panel conditions-panel" id="conditions" aria-busy={!data && !error}>
      <div className="conditions-head">
        <div>
          <h2>Route conditions</h2>
          <p className="field-hint">
            {data?.origin && data?.destination ? (
              <>
                {data.origin.name} → {data.destination.name}
                {data.route && (
                  <>
                    {" · "}
                    {data.route.approximate ? `about ${miles(data.route.distanceKm)} straight-line` : miles(data.route.distanceKm)}
                    {data.route.durationH != null && ` · ${Math.round(data.route.durationH)} h driving`}
                  </>
                )}
              </>
            ) : data ? (
              "Add an origin and destination to see this lane on the map."
            ) : error ? (
              error
            ) : (
              "Checking radar, weather alerts and news along the lane…"
            )}
          </p>
        </div>
        {data && <span className="conditions-updated">Updated {relativeTime(data.fetchedAt)}</span>}
      </div>

      {(placed || !data) && !error && (
        <LaneMap
          lanes={lanes}
          alerts={data?.alerts ?? []}
          endpoints={endpoints}
          bounds={data?.bounds ?? null}
          radar={data?.radarCoverage ?? true}
          height={340}
          ariaLabel="Map of this shipment's lane with weather radar"
        />
      )}

      {data && placed && (
        <div className="conditions-grid">
          <div>
            <h3 className="conditions-subhead">Weather alerts on the lane</h3>
            {!data.radarCoverage ? (
              <p className="field-hint">Weather alerts cover the US only.</p>
            ) : !data.alertsOk ? (
              <p className="field-hint">The weather service didn&apos;t respond. Try again in a few minutes.</p>
            ) : data.alerts.length === 0 ? (
              <p className="conditions-clear">No active alerts along this lane.</p>
            ) : (
              <ul className="alert-list">
                {data.alerts.slice(0, 6).map((a) => (
                  <li key={a.id} className={`alert-item tone-${SEVERITY_TONE[a.severity] ?? "muted"}`}>
                    <div className="alert-title">
                      <span className="alert-dot" aria-hidden="true" />
                      <strong>{a.event}</strong>
                      <span className="alert-sev">{a.severity}</span>
                    </div>
                    <p className="alert-area">{a.area.split(";").slice(0, 3).join(";")}</p>
                    {a.ends && <p className="alert-when">Ends {relativeTime(a.ends)}</p>}
                  </li>
                ))}
                {data.alerts.length > 6 && <li className="field-hint">+{data.alerts.length - 6} more</li>}
              </ul>
            )}
          </div>
          <div>
            <h3 className="conditions-subhead">In the news</h3>
            {!data.newsOk ? (
              <p className="field-hint">The news feed didn&apos;t respond. Try again in a few minutes.</p>
            ) : data.news.length === 0 ? (
              <p className="field-hint">Nothing freight-related in the last three days.</p>
            ) : (
              <ul className="news-list">
                {data.news.slice(0, 5).map((n) => (
                  <li key={n.url}>
                    <a href={n.url} target="_blank" rel="noopener noreferrer nofollow">
                      {n.title}
                    </a>
                    <span className="news-meta">
                      {n.domain}
                      {n.seenAt && ` · ${relativeTime(n.seenAt)}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {data && (data.issues.length > 0 || data.sources.length > 0) && (
        <p className="conditions-sources">
          {data.issues.filter((i) => !/unavailable/.test(i)).length > 0 && (
            <span className="conditions-issue">{data.issues.filter((i) => !/unavailable/.test(i)).join(" ")} </span>
          )}
          {data.route?.approximate && "Lane drawn as a straight line, not the road route. "}
          {data.sources.map((s, i) => (
            <span key={s.id}>
              {i > 0 && " · "}
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                {s.label}
              </a>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
