"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { NetworkConditions } from "@/conditions/service";
import type { NewsItem } from "@/conditions/news";

import { LaneMap, type MapLane } from "./lane-map";
import { relativeTime } from "./route-conditions";

/**
 * Live map: every lane at once over live radar and nationwide severe
 * weather warnings, the lanes those warnings touch, and a freight news
 * feed. All free public sources.
 */
export function NetworkMap() {
  const router = useRouter();
  const [data, setData] = useState<NetworkConditions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [news, setNews] = useState<NewsItem[] | null>(null);
  const [newsIssue, setNewsIssue] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/conditions/network")
      .then(async (res) => {
        if (!res.ok) throw new Error("Couldn't load the map data.");
        return res.json() as Promise<NetworkConditions>;
      })
      .then((d) => !cancelled && setData(d))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load the map data."));
    fetch("/api/conditions/news")
      .then((res) => res.json() as Promise<{ items: NewsItem[]; issue?: string }>)
      .then((d) => {
        if (cancelled) return;
        setNews(d.items ?? []);
        setNewsIssue(d.issue ?? null);
      })
      .catch(() => !cancelled && (setNews([]), setNewsIssue("News is unavailable right now.")));
    return () => {
      cancelled = true;
    };
  }, []);

  const hit = useMemo(() => data?.lanes.filter((l) => l.alertIds.length > 0) ?? [], [data]);
  const lanes = useMemo<MapLane[]>(
    () =>
      (data?.lanes ?? []).map((l) => ({
        id: l.shipmentId,
        label: l.label,
        path: l.path,
        tone: l.tone,
        approximate: true,
        emphasis: l.shipmentId === focus || (focus === null && l.alertIds.length > 0),
      })),
    [data, focus]
  );
  const alertById = useMemo(() => new Map((data?.alerts ?? []).map((a) => [a.id, a])), [data]);
  const laneCount = data?.lanes.length ?? 0;

  return (
    <div className="network-layout">
      <div className="network-map-col">
        <LaneMap
          lanes={lanes}
          alerts={data?.alerts ?? []}
          bounds={data?.bounds ?? null}
          height="min(68vh, 640px)"
          onLaneClick={(id) => router.push(`/shipments/${id}#conditions`)}
          ariaLabel="Map of all shipment lanes with weather radar and warnings"
        />
        <p className="conditions-sources">
          {error ?? (data ? `${laneCount} lane${laneCount === 1 ? "" : "s"} on the map` : "Loading lanes…")}
          {data && data.unplaced.length > 0 && ` · ${data.unplaced.length} couldn't be placed`}
          {" · "}Lanes are straight lines between endpoints. Click one to open it.
          {data?.sources.map((s) => (
            <span key={s.id}>
              {" · "}
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                {s.label}
              </a>
            </span>
          ))}
        </p>
      </div>

      <aside className="network-side">
        <section className="side-block">
          <h2 className="conditions-subhead">Lanes under a warning</h2>
          {!data ? (
            <p className="field-hint">Checking nationwide warnings…</p>
          ) : !data.alertsOk ? (
            <p className="field-hint">The weather service didn&apos;t respond. Try again in a few minutes.</p>
          ) : hit.length === 0 ? (
            <p className="conditions-clear">
              No lane crosses a severe or extreme warning right now
              {data.alerts.length > 0 ? ` (${data.alerts.length} active nationwide).` : "."}
            </p>
          ) : (
            <ul className="alert-list">
              {hit.slice(0, 8).map((lane) => {
                const alerts = lane.alertIds.map((id) => alertById.get(id)).filter(Boolean);
                return (
                  <li
                    key={lane.shipmentId}
                    className="alert-item tone-danger"
                    onMouseEnter={() => setFocus(lane.shipmentId)}
                    onMouseLeave={() => setFocus(null)}
                  >
                    <div className="alert-title">
                      <span className="alert-dot" aria-hidden="true" />
                      <Link href={`/shipments/${lane.shipmentId}#conditions`}>
                        <strong>{lane.label}</strong>
                      </Link>
                      <span className="alert-sev">
                        {lane.originName} → {lane.destinationName}
                      </span>
                    </div>
                    <p className="alert-area">{[...new Set(alerts.map((a) => a!.event))].join(", ")}</p>
                  </li>
                );
              })}
              {hit.length > 8 && <li className="field-hint">+{hit.length - 8} more lanes</li>}
            </ul>
          )}
        </section>

        <section className="side-block">
          <h2 className="conditions-subhead">Freight news</h2>
          {news === null ? (
            <p className="field-hint">Loading headlines…</p>
          ) : news.length === 0 ? (
            <p className="field-hint">{newsIssue ?? "No headlines in the last two days."}</p>
          ) : (
            <ul className="news-list">
              {news.map((n) => (
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
          {news && news.length > 0 && (
            <p className="conditions-sources">
              {news[0].provider === "google_news" ? (
                <a href="https://news.google.com" target="_blank" rel="noopener noreferrer">
                  News: Google News
                </a>
              ) : (
                <a href="https://www.gdeltproject.org" target="_blank" rel="noopener noreferrer">
                  News: The GDELT Project
                </a>
              )}
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}
