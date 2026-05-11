"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { ArrowLeft, FileSpreadsheet, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { APP_CONFIG } from "@/config/app-theme";
import { mapZipdjCsvRecord } from "@/lib/shared/zipdjCsvMap";

type RowStatus = "pending" | "processing" | "done" | "error";

type CsvRow = {
  trackId: string;
  trackName: string;
  trackUrl: string;
  releaseName: string;
  releaseId: string;
  labelName: string;
  labelId: string;
  artistsName: string;
  genre: string;
  tags: string;
  trackCreatedDate: string;
  releaseCreatedDate: string;
};

type QueueItem = CsvRow & {
  status: RowStatus;
  detail?: string;
};

function mappedToCsvRow(m: NonNullable<ReturnType<typeof mapZipdjCsvRecord>>): CsvRow {
  return {
    trackId: m.track_id,
    trackName: m.track_name,
    trackUrl: m.track_url ?? "",
    releaseName: m.release_name,
    releaseId: m.release_id ?? "",
    labelName: m.label_name ?? "",
    labelId: m.label_id ?? "",
    artistsName: m.artists_name ?? "",
    genre: m.genre ?? "",
    tags: m.tags ?? "",
    trackCreatedDate: m.track_created_date ?? "",
    releaseCreatedDate: m.release_created_date ?? "",
  };
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

export default function BulkZipdjCsvPage() {
  const [rows, setRows] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = useCallback((file: File) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      delimiter: "",
      complete: (res) => {
        const out: QueueItem[] = [];
        for (const rec of res.data) {
          const m = mapZipdjCsvRecord(rec);
          if (m) out.push({ ...mappedToCsvRow(m), status: "pending" });
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
    const snapshot = rows;
    const pendingIdx = snapshot
      .map((r, i) => i)
      .filter((i) => snapshot[i].status === "pending");
    if (!pendingIdx.length) return;

    setRunning(true);

    await runPool(4, pendingIdx.length, async (k) => {
      const i = pendingIdx[k];
      const row = snapshot[i];
      updateRow(i, { status: "processing", detail: undefined });

      try {
        const ingest = await fetch("/api/zipdj/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            track_id: row.trackId,
            track_name: row.trackName,
            track_url: row.trackUrl || null,
            release_name: row.releaseName,
            release_id: row.releaseId || null,
            label_name: row.labelName || null,
            label_id: row.labelId || null,
            artists_name: row.artistsName || null,
            genre: row.genre || null,
            tags: row.tags || null,
            track_created_date: row.trackCreatedDate || null,
            release_created_date: row.releaseCreatedDate || null,
          }),
        });
        const data = await ingest.json();
        if (!ingest.ok) throw new Error(data.error || "Ingest failed");

        updateRow(i, { status: "done" });
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
          href="/creator/upload"
          className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Creator
        </Link>

        <header>
          <h1 className="text-3xl font-bold text-white">Bulk ZipDJ CSV</h1>
          <p className="mt-2 max-w-2xl text-slate-400">
            Metadata-only ingest into <code className="text-slate-300">zipdj_tracks_ai</code>. Required
            columns: <code className="text-slate-300">track_id</code>,{" "}
            <code className="text-slate-300">release_name</code>. Also map{" "}
            <code className="text-slate-300">track_name</code>,{" "}
            <code className="text-slate-300">track_url</code>,{" "}
            <code className="text-slate-300">release_id</code>,{" "}
            <code className="text-slate-300">label_name</code>,{" "}
            <code className="text-slate-300">label_id</code>,{" "}
            <code className="text-slate-300">artists_name</code>,{" "}
            <code className="text-slate-300">genre</code>, <code className="text-slate-300">tags</code>, optional{" "}
            <code className="text-slate-300">track_created_date</code>,{" "}
            <code className="text-slate-300">release_created_date</code> — ISO dates, or{" "}
            <strong className="text-slate-300">Unix seconds</strong> (10 digits) / ms (13 digits) as in ZipDJ exports.
            Tab-separated (TSV) files work; Papa auto-detects delimiter. For tens of thousands of rows use the CLI{" "}
            <code className="text-slate-300">npm run import:zipdj</code> (batched embeddings + multi-row upserts).
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
                      <div className="font-medium text-slate-200">{r.releaseName}</div>
                      <div className="truncate text-xs text-slate-500">
                        {r.trackName ? `${r.trackName} · ` : ""}
                        {r.trackId}
                      </div>
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
