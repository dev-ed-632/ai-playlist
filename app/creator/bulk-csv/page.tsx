"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { ArrowLeft, FileSpreadsheet, Loader2, CheckCircle2, AlertCircle, Youtube } from "lucide-react";
import { APP_CONFIG } from "@/config/app-theme";
import {
  extractFeaturesFromArrayBuffer,
  initAudioWorkers,
  neutralFeaturesForMetadataOnly,
} from "@/lib/client/audio-ingest";
import { classifyTrackUrl } from "@/lib/shared/track-url";
import { waveformFetchUrl } from "@/lib/shared/audio-proxy";

type RowStatus = "pending" | "processing" | "done" | "error";

type CsvRow = {
  trackId: string;
  trackname: string;
  releaseName: string;
  artists: string;
  genre: string;
  label: string;
  trackUrl: string;
  isExplicit?: boolean;
};

type QueueItem = CsvRow & {
  status: RowStatus;
  detail?: string;
  metadataOnly?: boolean;
};

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "");
}

function mapRecord(rec: Record<string, string>): CsvRow | null {
  const keys = Object.keys(rec);
  const byNorm: Record<string, string> = {};
  for (const k of keys) {
    byNorm[normHeader(k)] = rec[k]?.trim() ?? "";
  }
  const trackname =
    byNorm["trackname"] ||
    byNorm["track_name"] ||
    byNorm["title"] ||
    "";
  const trackUrl = byNorm["trackurl"] || byNorm["track_url"] || "";
  if (!trackname || !trackUrl) return null;
  const ex = byNorm["isexplicit"] || byNorm["explicit"];
  let isExplicit: boolean | undefined;
  if (/^(1|true|yes)$/i.test(ex)) isExplicit = true;
  if (/^(0|false|no)$/i.test(ex)) isExplicit = false;

  return {
    trackId: byNorm["trackid"] || byNorm["externalid"] || "",
    trackname,
    releaseName: byNorm["releasename"] || byNorm["release"] || "",
    artists: byNorm["artists"] || byNorm["artist"] || "",
    genre: byNorm["genre"] || "",
    label: byNorm["label"] || "",
    trackUrl,
    isExplicit,
  };
}

function parseArtists(s: string): string[] {
  return s
    .split(/[,;|]+/)
    .map((a) => a.trim())
    .filter(Boolean);
}

async function runPool(size: number, total: number, worker: (i: number) => Promise<void>) {
  let i = 0;
  async function run() {
    while (i < total) {
      const idx = i++;
      await worker(idx);
    }
  }
  await Promise.all(Array.from({ length: size }, run));
}

export default function BulkCsvPage() {
  const [rows, setRows] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const [prepNote, setPrepNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = useCallback((file: File) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      delimiter: "",
      complete: (res) => {
        const out: QueueItem[] = [];
        for (const rec of res.data) {
          const m = mapRecord(rec);
          if (m) out.push({ ...m, status: "pending" });
        }
        setRows(out);
      },
      error: (err) => console.error(err),
    });
  }, []);

  const updateRow = (idx: number, patch: Partial<QueueItem>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const processAll = async () => {
    setPrepNote(null);
    const snapshot = rows;
    const pendingIdx = snapshot
      .map((r, i) => i)
      .filter((i) => snapshot[i].status === "pending");
    if (!pendingIdx.length) return;

    const needsMl = pendingIdx.some((i) => classifyTrackUrl(snapshot[i].trackUrl) === "audio");
    if (needsMl) {
      setPrepNote("Loading ML models for direct-audio rows (first time can take 1–3 minutes)…");
      try {
        await initAudioWorkers();
      } catch (e) {
        setPrepNote(
          e instanceof Error ? e.message : "Failed to load audio workers. Check the browser console."
        );
        return;
      }
      setPrepNote(null);
    }

    setRunning(true);

    await runPool(4, pendingIdx.length, async (k) => {
      const i = pendingIdx[k];
      const row = snapshot[i];
      updateRow(i, { status: "processing", detail: undefined });

      try {
        const kind = classifyTrackUrl(row.trackUrl);
        let extracted = neutralFeaturesForMetadataOnly();
        let metadataOnly = kind === "youtube";

        if (kind === "audio") {
          const res = await fetch(waveformFetchUrl(row.trackUrl));
          if (!res.ok) {
            throw new Error(`Audio fetch ${res.status}`);
          }
          const buf = await res.arrayBuffer();
          extracted = await extractFeaturesFromArrayBuffer(buf);
          metadataOnly = false;
        }

        const artistList = parseArtists(row.artists);
        const body: Record<string, unknown> = {
          track_name: row.trackname,
          artist_names: artistList.length ? artistList : ["Unknown"],
          track_url: row.trackUrl.trim(),
          genre: row.genre.trim() || "Unknown",
          bpm: extracted.bpm,
          release_name: row.releaseName.trim() || null,
          label: row.label.trim() || null,
          musical_key: extracted.key === "Unknown" ? null : extracted.key,
          features: {
            danceability: extracted.danceability,
            aggressiveness: extracted.aggressiveness,
            mood_happy: extracted.mood_happy,
            mood_sad: extracted.mood_sad,
            mood_relaxed: extracted.mood_relaxed,
            engagement: extracted.engagement,
            approachability: extracted.approachability,
          },
        };
        if (row.trackId.trim()) body.external_track_id = row.trackId.trim();
        if (row.isExplicit !== undefined) body.is_explicit = row.isExplicit;

        const ingest = await fetch("/api/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await ingest.json();
        if (!ingest.ok) throw new Error(data.error || "Ingest failed");

        updateRow(i, {
          status: "done",
          detail: metadataOnly ? "metadata-only (YouTube URL)" : undefined,
          metadataOnly,
        });
      } catch (e: unknown) {
        updateRow(i, {
          status: "error",
          detail: e instanceof Error ? e.message : "Failed",
        });
      }
    });

    setRunning(false);
  };

  const pending = rows.filter((r) => r.status === "pending").length;
  const done = rows.filter((r) => r.status === "done").length;
  const err = rows.filter((r) => r.status === "error").length;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#070b14] px-4 py-12 sm:px-8">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-28 left-1/2 h-112 w-md -translate-x-1/2 rounded-full bg-primary/20 blur-[130px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-4xl space-y-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>

        <header>
          <h1 className="text-3xl font-bold text-white">Bulk CSV ingest</h1>
          <p className="mt-2 max-w-2xl text-slate-400">
            Columns: <code className="text-slate-300">trackId</code>,{" "}
            <code className="text-slate-300">trackname</code>,{" "}
            <code className="text-slate-300">releaseName</code>,{" "}
            <code className="text-slate-300">artists</code>,{" "}
            <code className="text-slate-300">genre</code>,{" "}
            <code className="text-slate-300">label</code>,{" "}
            <code className="text-slate-300">trackUrl</code>. Optional:{" "}
            <code className="text-slate-300">isExplicit</code>. Direct MP3 URLs are analyzed in-browser;
            YouTube links use metadata-only defaults (same embedding text pipeline).
          </p>
        </header>

        <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-6">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-xl border border-primary/50 bg-primary/15 px-4 py-3 text-sm font-semibold text-primary hover:bg-primary/25"
          >
            <FileSpreadsheet className="h-5 w-5" />
            Choose CSV
          </button>

          {prepNote && (
            <p className="mt-3 flex items-center gap-2 text-sm text-amber-400">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              {prepNote}
            </p>
          )}

          <p className="mt-3 text-xs text-slate-500">
            You can pick a CSV anytime. ML models load only when you process rows with{" "}
            <strong className="text-slate-400">direct audio</strong> URLs (not YouTube).
          </p>

          {rows.length > 0 && (
            <div className="mt-6 space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400">
                <span>{rows.length} rows</span>
                <span>·</span>
                <span>{pending} pending</span>
                <span>·</span>
                <span className="text-emerald-400">{done} done</span>
                {err > 0 && (
                  <>
                    <span>·</span>
                    <span className="text-red-400">{err} errors</span>
                  </>
                )}
              </div>
              <button
                type="button"
                disabled={running || pending === 0}
                onClick={() => void processAll()}
                className="rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40"
              >
                {running ? "Processing…" : "Process pending rows"}
              </button>

              <ul className="max-h-[420px] space-y-2 overflow-y-auto rounded-xl border border-slate-700/80 p-3">
                {rows.map((r, idx) => (
                  <li
                    key={idx}
                    className="flex flex-wrap items-start gap-2 border-b border-slate-800/80 py-2 text-sm last:border-0"
                  >
                    {r.status === "processing" && (
                      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
                    )}
                    {r.status === "done" && (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    )}
                    {r.status === "error" && (
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                    )}
                    {r.status === "pending" && (
                      <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border border-slate-600" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-200">{r.trackname}</div>
                      <div className="truncate text-xs text-slate-500">{r.trackUrl}</div>
                      {r.metadataOnly && (
                        <span className="mt-1 inline-flex items-center gap-1 text-xs text-amber-400">
                          <Youtube className="h-3 w-3" /> {r.detail}
                        </span>
                      )}
                      {r.status === "error" && r.detail && (
                        <div className="text-xs text-red-400">{r.detail}</div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-slate-600">{APP_CONFIG.projectName}</p>
      </div>
    </div>
  );
}
