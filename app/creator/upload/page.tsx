"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Upload, Activity, FileAudio, X, CheckCircle2, Loader2, Users, Plus, ListMusic } from "lucide-react";
import { APP_CONFIG } from "@/config/app-theme";
import { extractFeaturesFromFile, initAudioWorkers } from "@/lib/client/audio-ingest";

// ════════════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════════════

type TrackEntry = {
  file: File;
  trackName: string;
  /** Maps to DB `artist_names TEXT[]` */
  artistNames: string[];
  /** Local buffer for “add artist” input (comma / Enter commits). */
  artistDraft: string;
  genre: string;
  trackUrl: string;
  status: "pending" | "processing" | "done" | "error";
  result?: any;
  error?: string;
};

function commitArtistDraft(artistNames: string[], draft: string): { artistNames: string[]; artistDraft: string } {
  const parts = draft.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
  if (!parts.length) return { artistNames, artistDraft: draft };
  const next = [...artistNames];
  for (const p of parts) {
    if (!next.some(a => a.toLowerCase() === p.toLowerCase())) next.push(p);
  }
  return { artistNames: next, artistDraft: "" };
}

function ArtistField({
  artists,
  draft,
  onDraftChange,
  onCommit,
  onRemove,
  disabled,
}: {
  artists: string[];
  draft: string;
  onDraftChange: (v: string) => void;
  onCommit: () => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-600/80 bg-slate-900/40 p-3">
      <div className="mb-2 flex min-h-7 flex-wrap items-center gap-1.5">
        {artists.length === 0 ? (
          <span className="text-xs text-slate-500">No artists yet — ingests as &quot;Unknown&quot;</span>
        ) : (
          artists.map((a, i) => (
            <span
              key={`${a}-${i}`}
              className="inline-flex max-w-full items-center gap-1 rounded-lg border border-slate-600 bg-slate-800/90 pl-2 pr-0.5 py-0.5 text-xs text-slate-200"
            >
              <span className="truncate">{a}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onRemove(i)}
                className="shrink-0 rounded-md p-0.5 text-slate-500 hover:bg-slate-700 hover:text-red-400 disabled:opacity-40"
                aria-label={`Remove ${a}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))
        )}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          value={draft}
          disabled={disabled}
          onChange={e => onDraftChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") {
              e.preventDefault();
              onCommit();
            }
          }}
          placeholder="Artist name — Enter or comma for several"
          className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-800/80 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-primary focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={onCommit}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-primary/50 bg-primary/15 px-3 py-2 text-xs font-bold uppercase tracking-wide text-primary hover:bg-primary/25 disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Component
// ════════════════════════════════════════════════════════════════════════════

export default function UploadPage() {
  const [tracks, setTracks]           = useState<TrackEntry[]>([]);
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const [workerStatus, setWorkerStatus] = useState<"loading" | "ready">("loading");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    initAudioWorkers()
      .then(() => setWorkerStatus("ready"))
      .catch((e) => { console.error("Worker init:", e); setWorkerStatus("ready"); });
  }, []);

  const addFiles = useCallback((files: File[]) => {
    if (!files.length) return;
    setTracks(prev => [
      ...prev,
      ...files.map(f => ({
        file: f,
        trackName: f.name.replace(/\.[^/.]+$/, ""),
        artistNames: [] as string[],
        artistDraft: "",
        genre: "",
        trackUrl: "",
        status: "pending" as const,
      })),
    ]);
  }, []);

  const handleFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list?.length) return;
    addFiles(Array.from(list));
    e.target.value = "";
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const dropped = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("audio/"));
    addFiles(dropped);
  };

  const updateTrack = (idx: number, patch: Partial<TrackEntry>) =>
    setTracks(prev => prev.map((t, i) => i === idx ? { ...t, ...patch } : t));

  const removeTrack = (idx: number) =>
    setTracks(prev => prev.filter((_, i) => i !== idx));

  const processAll = useCallback(async () => {
    const idxs = tracks.map((_, i) => i).filter(i => tracks[i].status === "pending");
    if (!idxs.length) return;
    setIsProcessingAll(true);
    for (const i of idxs) {
      const row = tracks[i];
      const committed = commitArtistDraft(row.artistNames, row.artistDraft);
      updateTrack(i, { status: "processing", artistNames: committed.artistNames, artistDraft: committed.artistDraft });
      try {
        const extracted = await extractFeaturesFromFile(row.file);
        const res = await fetch("/api/ingest", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            track_name:   row.trackName || row.file.name,
            artist_names: committed.artistNames.length ? committed.artistNames : ["Unknown"],
            track_url:    row.trackUrl.trim() || null,
            genre:        row.genre || "Unknown",
            bpm:          extracted.bpm,
            musical_key:  extracted.key === "Unknown" ? null : extracted.key,
            features: {
              danceability:    extracted.danceability,
              aggressiveness:  extracted.aggressiveness,
              mood_happy:      extracted.mood_happy,
              mood_sad:        extracted.mood_sad,
              mood_relaxed:    extracted.mood_relaxed,
              engagement:      extracted.engagement,
              approachability: extracted.approachability,
            },
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Ingest failed");
        updateTrack(i, { status: "done", result: { ...data, extracted } });
      } catch (err: any) {
        updateTrack(i, { status: "error", error: err.message });
      }
    }
    setIsProcessingAll(false);
  }, [tracks]);

  const pendingCount = tracks.filter(t => t.status === "pending").length;
  const doneCount = tracks.filter(t => t.status === "done").length;
  const errorCount = tracks.filter(t => t.status === "error").length;
  const totalCount = tracks.length;
  const processedCount = doneCount + errorCount;
  const progressPercent = totalCount > 0 ? Math.round((processedCount / totalCount) * 100) : 0;
  const hasTracksToShow = tracks.length > 0;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#070b14] px-4 py-12 sm:px-8">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-28 left-1/2 h-112 w-md -translate-x-1/2 rounded-full bg-primary/20 blur-[130px]" />
        <div className="absolute bottom-0 left-0 h-72 w-72 rounded-full bg-primary/15 blur-[100px]" />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-8">

        <header className="flex flex-wrap items-center gap-4">
          <Link href="/" className="inline-flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm">
            <ArrowLeft className="w-4 h-4" /> Home
          </Link>
          <Link
            href="/creator/bulk-csv"
            className="text-sm font-medium text-primary hover:underline"
          >
            Bulk CSV ingest
          </Link>
          <Link
            href="/creator/bulk-zipdj-csv"
            className="text-sm font-medium text-primary hover:underline"
          >
            Bulk ZipDJ CSV
          </Link>
        </header>

        <section className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-4 rounded-3xl border border-slate-800/80 bg-[#0b1220]/85 p-6 sm:p-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/35 bg-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-primary">
              <Activity className="h-3.5 w-3.5" />
              {APP_CONFIG.projectName} Ingestion Lab
            </div>
            <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
              Upload audio and build your DJ-ready library
            </h1>
            <p className="max-w-2xl text-sm text-slate-300 sm:text-base">
              Batch upload tracks, analyze them, and add them to your library.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-800/80 bg-[#0b1220]/85 p-6">
            <p className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Deck Activity</p>
            <svg viewBox="0 0 360 160" className="w-full" aria-hidden>
              <rect x="16" y="20" width="328" height="120" rx="16" fill="#0a1427" stroke="#1e2a44" />
              <g transform="translate(92 82)">
                <circle r="34" fill="#08101f" stroke="#1d355e" />
                <circle r="23" fill="none" stroke="#27487c" />
                <circle r="7" fill={APP_CONFIG.theme.primary} />
                <circle r="34" fill="none" stroke={APP_CONFIG.theme.primary} opacity="0.35">
                  <animateTransform attributeName="transform" type="rotate" from="0 0 0" to="360 0 0" dur="2.4s" repeatCount="indefinite" />
                </circle>
              </g>
              <g transform="translate(268 82)">
                <circle r="28" fill="#08101f" stroke="#1d355e" />
                <circle r="18" fill="none" stroke="#27487c" />
                <circle r="6" fill={APP_CONFIG.theme.primary} />
                <circle r="28" fill="none" stroke={APP_CONFIG.theme.primary} opacity="0.35">
                  <animateTransform attributeName="transform" type="rotate" from="360 0 0" to="0 0 0" dur="2.8s" repeatCount="indefinite" />
                </circle>
              </g>
              {[166, 178, 190].map((x, i) => (
                <rect key={x} x={x} y="48" width="5" height="58" rx="2.5" fill="#1b2f52">
                  <animate attributeName="y" values={`${48 + i * 4};${68 - i * 4};${52 + i * 2};${48 + i * 4}`} dur={`${1.6 + i * 0.35}s`} repeatCount="indefinite" />
                  <animate attributeName="height" values={`${58 - i * 2};${40 + i * 7};${52 - i * 2};${58 - i * 2}`} dur={`${1.6 + i * 0.35}s`} repeatCount="indefinite" />
                </rect>
              ))}
            </svg>

            <div className="mt-5 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2.5">
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">Pending</p>
                <p className="text-lg font-bold text-white">{pendingCount}</p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2.5">
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">Done</p>
                <p className="text-lg font-bold text-emerald-400">{doneCount}</p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2.5">
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">Errors</p>
                <p className="text-lg font-bold text-red-400">{errorCount}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-slate-900/85 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-300">
              Worker status:{" "}
              {workerStatus === "loading" ? (
                <span className="inline-flex items-center gap-1 text-yellow-400">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading models...
                </span>
              ) : (
                <span className="text-emerald-400">Ready</span>
              )}
            </p>
            {tracks.length > 0 && (
              <button
                onClick={() => setTracks([])}
                disabled={isProcessingAll}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:border-primary/50 hover:text-white disabled:opacity-50"
              >
                Clear list
              </button>
            )}
          </div>

          {hasTracksToShow && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-semibold uppercase tracking-wider text-slate-400">Overall Progress</span>
                <span className="font-mono text-slate-300">
                  {processedCount}/{totalCount} ({progressPercent}%)
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}

          {/* Drop zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className="group rounded-2xl border-2 border-dashed border-slate-700 bg-slate-900/40 p-10 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all hover:border-primary/55 hover:bg-primary/5"
          >
            <input ref={fileInputRef} type="file" accept="audio/*" multiple className="hidden" onChange={handleFilesChange} />
            <div className="rounded-full border border-slate-700 bg-slate-800/80 p-4 transition-all group-hover:border-primary/60 group-hover:bg-primary/10">
              <Upload className="w-8 h-8 text-slate-400 group-hover:text-primary transition-colors" />
            </div>
            <p className="text-white font-semibold">Drop tracks here or click to upload</p>
            <p className="text-slate-500 text-sm">MP3, WAV, FLAC • multiple files supported</p>
          </div>

          {/* Track queue */}
          {hasTracksToShow && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
                <div className="flex items-center gap-2 text-slate-400">
                  <ListMusic className="h-4 w-4 text-primary" />
                  <span className="text-[11px] font-bold uppercase tracking-[0.2em]">Queue</span>
                  <span className="text-sm text-slate-300">
                    {totalCount} file{totalCount !== 1 ? "s" : ""}
                    {pendingCount > 0 && (
                      <span className="text-slate-500"> · {pendingCount} to ingest</span>
                    )}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                {tracks.map((t, i) => (
                  <div
                    key={`${t.file.name}-${t.file.size}-${i}`}
                    className="overflow-hidden rounded-2xl border border-slate-700/70 bg-gradient-to-b from-slate-800/90 to-slate-900/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                  >
                    <div className="flex items-center justify-between gap-3 border-b border-slate-700/60 bg-slate-900/40 px-4 py-2.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-[11px] font-black text-primary">
                          {i + 1}
                        </span>
                        <FileAudio className="h-4 w-4 shrink-0 text-primary" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-200">{t.file.name}</p>
                          <p className="text-[11px] text-slate-500">{(t.file.size / 1048576).toFixed(1)} MB</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {t.status === "processing" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                        {t.status === "done" && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                        {t.status === "error" && (
                          <span className="max-w-[180px] truncate text-xs text-red-400">{t.error}</span>
                        )}
                        {t.status === "pending" && (
                          <button
                            type="button"
                            onClick={() => removeTrack(i)}
                            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-red-400"
                            aria-label="Remove from queue"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="space-y-4 p-4">
                      {t.status === "pending" && (
                        <>
                          <div>
                            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                              Track title
                            </label>
                            <input
                              type="text"
                              value={t.trackName}
                              onChange={e => updateTrack(i, { trackName: e.target.value })}
                              placeholder="Title as it should appear in search"
                              className="w-full rounded-xl border border-slate-600 bg-slate-800/80 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-primary focus:outline-none"
                            />
                          </div>

                          <div>
                            <label className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                              <Users className="h-3 w-3" />
                              Artists (multiple)
                            </label>
                            <ArtistField
                              artists={t.artistNames}
                              draft={t.artistDraft}
                              onDraftChange={v => updateTrack(i, { artistDraft: v })}
                              onCommit={() => {
                                const { artistNames, artistDraft } = commitArtistDraft(t.artistNames, t.artistDraft);
                                updateTrack(i, { artistNames, artistDraft });
                              }}
                              onRemove={j =>
                                updateTrack(i, { artistNames: t.artistNames.filter((_, k) => k !== j) })
                              }
                            />
                          </div>

                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                Genre
                              </label>
                              <input
                                type="text"
                                value={t.genre}
                                onChange={e => updateTrack(i, { genre: e.target.value })}
                                placeholder="e.g. House, Techno"
                                className="w-full rounded-xl border border-slate-600 bg-slate-800/80 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-primary focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                Playback URL <span className="font-normal normal-case text-slate-600">(optional)</span>
                              </label>
                              <input
                                type="url"
                                value={t.trackUrl}
                                onChange={e => updateTrack(i, { trackUrl: e.target.value })}
                                placeholder="https://…"
                                className="w-full rounded-xl border border-slate-600 bg-slate-800/80 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-primary focus:outline-none"
                              />
                            </div>
                          </div>
                        </>
                      )}

                      {(t.status === "done" || t.status === "processing" || t.status === "error") &&
                        t.artistNames.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {t.artistNames.map((a, j) => (
                              <span
                                key={`${a}-${j}`}
                                className="rounded-md border border-slate-600/80 bg-slate-900/60 px-2 py-0.5 text-xs text-slate-300"
                              >
                                {a}
                              </span>
                            ))}
                          </div>
                        )}

                      {t.status === "done" && t.trackUrl.trim() && (
                        <p className="text-xs text-slate-500">
                          URL saved:{" "}
                          <span className="break-all text-primary">{t.trackUrl.trim()}</span>
                        </p>
                      )}

                      {t.status === "done" && t.result?.extracted && (() => {
                        const x = t.result.extracted;
                        return (
                          <div>
                            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                              Analysis
                            </p>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs">
                              {(
                                [
                                  ["BPM", Math.round(x.bpm)],
                                  ["Key", x.key],
                                  ["Dance", x.danceability.toFixed(2)],
                                  ["Aggressive", x.aggressiveness.toFixed(2)],
                                  ["Happy", x.mood_happy.toFixed(2)],
                                  ["Sad", x.mood_sad.toFixed(2)],
                                  ["Relaxed", x.mood_relaxed.toFixed(2)],
                                  ["ID", (t.result.trackId?.slice(0, 8) ?? "—") + "…"],
                                ] as [string, unknown][]
                              ).map(([label, val]) => (
                                <div key={label} className="rounded-lg bg-slate-900/80 p-2 ring-1 ring-white/5">
                                  <div className="mb-0.5 text-slate-500">{label}</div>
                                  <div className="font-mono text-white">{String(val)}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Extract button — always in DOM when tracks exist, visibility via style */}
          <button
            onClick={processAll}
            disabled={isProcessingAll || pendingCount === 0}
            style={{ display: hasTracksToShow ? "block" : "none" }}
            className="w-full py-4 font-bold rounded-xl transition-all text-white text-base bg-primary shadow-[0_12px_30px_rgba(0,87,193,0.35)] hover:brightness-110 disabled:bg-slate-600 disabled:shadow-none disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isProcessingAll
              ? "Processing…"
              : pendingCount === 0
                ? "All tracks processed"
                : `Extract & Ingest ${pendingCount} Track${pendingCount !== 1 ? "s" : ""}`}
          </button>

        </section>
      </div>
    </div>
  );
}