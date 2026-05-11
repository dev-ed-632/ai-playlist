"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, Radio, Search } from "lucide-react";
import { AudioPlayer, type ZipdjRecommendPick } from "@/components/audio-player";

const PAGE_SIZE = 50;

type CatalogTrack = {
  trackId: string;
  releaseName: string;
  trackName: string;
  trackUrl: string | null;
  artistsName: string | null;
  genre: string | null;
  labelName: string | null;
  trackCreatedDate: string | null;
  releaseCreatedDate: string | null;
  vecDist?: number;
};

type AppliedQuery = {
  q: string;
  artist: string;
  label: string;
  genre: string;
  releaseDateFrom: string;
  releaseDateTo: string;
  page: number;
};

const initialApplied: AppliedQuery = {
  q: "",
  artist: "",
  label: "",
  genre: "",
  releaseDateFrom: "",
  releaseDateTo: "",
  page: 1,
};

function buildSearchParams(a: AppliedQuery): string {
  const p = new URLSearchParams();
  p.set("page", String(a.page));
  if (a.q.trim()) p.set("q", a.q.trim());
  if (a.artist.trim()) p.set("artist", a.artist.trim());
  if (a.label.trim()) p.set("label", a.label.trim());
  if (a.genre.trim()) p.set("genre", a.genre.trim());
  if (a.releaseDateFrom.trim()) p.set("releaseDateFrom", a.releaseDateFrom.trim());
  if (a.releaseDateTo.trim()) p.set("releaseDateTo", a.releaseDateTo.trim());
  return p.toString();
}

export default function ZipdjCatalogPage() {
  const [draftQ, setDraftQ] = useState("");
  const [draftArtist, setDraftArtist] = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftGenre, setDraftGenre] = useState("");
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");

  const [applied, setApplied] = useState<AppliedQuery>(initialApplied);

  const [tracks, setTracks] = useState<CatalogTrack[]>([]);
  const [total, setTotal] = useState(0);
  const [mode, setMode] = useState<"browse" | "vector" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [playingUrl, setPlayingUrl] = useState<{
    url: string;
    title: string;
    subtitle: string;
    recommendContext: {
      releaseName: string;
      trackName: string | null;
      artistsName: string | null;
      labelName: string | null;
      genre: string | null;
      excludeTrackId: string;
    };
  } | null>(null);

  const fetchCatalog = useCallback(async (a: AppliedQuery) => {
    setLoading(true);
    setError(null);
    try {
      const qs = buildSearchParams(a);
      const res = await fetch(`/api/zipdj/catalog-search?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setTracks(Array.isArray(data.tracks) ? data.tracks : []);
      setTotal(typeof data.total === "number" ? data.total : 0);
      setMode(data.mode === "vector" ? "vector" : "browse");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setTracks([]);
      setTotal(0);
      setMode(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCatalog(applied);
  }, [applied, fetchCatalog]);

  function handleSearch(e?: FormEvent<HTMLFormElement>) {
    e?.preventDefault();
    setApplied({
      q: draftQ,
      artist: draftArtist,
      label: draftLabel,
      genre: draftGenre,
      releaseDateFrom: draftFrom,
      releaseDateTo: draftTo,
      page: 1,
    });
  }

  function clearFilters() {
    setDraftArtist("");
    setDraftLabel("");
    setDraftGenre("");
    setDraftFrom("");
    setDraftTo("");
    setApplied((prev) => ({
      ...prev,
      artist: "",
      label: "",
      genre: "",
      releaseDateFrom: "",
      releaseDateTo: "",
      page: 1,
    }));
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canPrev = applied.page > 1;
  const canNext = applied.page * PAGE_SIZE < total;

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/35 bg-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
            <Radio className="h-3.5 w-3.5" />
            ZipDJ catalog
          </div>
          <Link
            href="/zipdj-prompt"
            className="text-xs font-semibold text-slate-500 underline-offset-2 hover:text-primary hover:underline"
          >
            ZipDJ prompt (vibe + web)
          </Link>
        </div>

        <h1 className="mb-2 text-3xl font-black tracking-tight sm:text-4xl">Catalog search</h1>
        <p className="mb-8 max-w-2xl text-slate-400">
          Search <code className="text-slate-300">zipdj_tracks_ai</code> with the same 384-d embeddings
          as ingest, or browse by <span className="text-slate-300">release_created_date</span> (newest
          first, 50 per page). Filter by artist, label, genre, or release date range.
        </p>

        {error && (
          <div className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSearch} className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label htmlFor="zipdj-q" className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Search (release, track, artist, label, genre — vector)
              </label>
              <input
                id="zipdj-q"
                type="search"
                value={draftQ}
                onChange={(e) => setDraftQ(e.target.value)}
                placeholder="Leave empty to browse by release date…"
                className="w-full rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-primary focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Search
            </button>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Filters</span>
              <button
                type="button"
                onClick={clearFilters}
                className="text-xs font-semibold text-slate-400 underline-offset-2 hover:text-white hover:underline"
              >
                Clear filters
              </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs text-slate-500">Artist</label>
                <input
                  value={draftArtist}
                  onChange={(e) => setDraftArtist(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  placeholder="ILIKE match"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Label</label>
                <input
                  value={draftLabel}
                  onChange={(e) => setDraftLabel(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  placeholder="ILIKE match"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Genre</label>
                <input
                  value={draftGenre}
                  onChange={(e) => setDraftGenre(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  placeholder="ILIKE match"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Release date from</label>
                <input
                  type="date"
                  value={draftFrom}
                  onChange={(e) => setDraftFrom(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Release date to</label>
                <input
                  type="date"
                  value={draftTo}
                  onChange={(e) => setDraftTo(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-600">
              Apply filters with <span className="text-slate-400">Search</span> (or change page — filters
              use last-applied values). Clear filters keeps your search text.
            </p>
          </div>
        </form>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
          <span>
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </span>
            ) : (
              <>
                {total} result{total === 1 ? "" : "s"}
                {mode && (
                  <span className="text-slate-600">
                    {" "}
                    · {mode === "vector" ? "vector similarity" : "newest releases first"}
                  </span>
                )}
                {" · "}
                Page {applied.page} of {totalPages}
              </>
            )}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!canPrev || loading}
              onClick={() => setApplied((p) => ({ ...p, page: p.page - 1 }))}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-primary/50 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" /> Prev
            </button>
            <button
              type="button"
              disabled={!canNext || loading}
              onClick={() => setApplied((p) => ({ ...p, page: p.page + 1 }))}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-primary/50 disabled:opacity-40"
            >
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/40">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs font-bold uppercase tracking-wide text-slate-500">
                <th className="w-14 px-3 py-3">Play</th>
                <th className="px-3 py-3">Release (track)</th>
                <th className="px-3 py-3">Artists</th>
                <th className="px-3 py-3">Label</th>
                <th className="px-3 py-3">Genre</th>
                <th className="px-3 py-3">Track date</th>
                <th className="px-3 py-3">Release date</th>
              </tr>
            </thead>
            <tbody>
              {!loading && tracks.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-slate-500">
                    No tracks match. Ingest catalog data or adjust filters / search.
                  </td>
                </tr>
              )}
              {tracks.map((t) => {
                const releaseTrack =
                  t.trackName?.trim() !== ""
                    ? `${t.releaseName} (${t.trackName})`
                    : t.releaseName;
                return (
                  <tr key={t.trackId} className="border-b border-slate-800/80 last:border-0 hover:bg-slate-800/30">
                    <td className="px-3 py-2 align-middle">
                      {t.trackUrl ? (
                        <button
                          type="button"
                          onClick={() =>
                            setPlayingUrl({
                              url: t.trackUrl!,
                              title: t.releaseName,
                              subtitle: t.trackName || "",
                              recommendContext: {
                                releaseName: t.releaseName,
                                trackName: t.trackName || null,
                                artistsName: t.artistsName,
                                labelName: t.labelName,
                                genre: t.genre,
                                excludeTrackId: t.trackId,
                              },
                            })
                          }
                          className="text-xs font-bold uppercase tracking-wide text-primary hover:underline"
                        >
                          Play
                        </button>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </td>
                    <td className="max-w-[220px] px-3 py-2 font-medium text-slate-200">
                      <span className="line-clamp-2" title={releaseTrack}>
                        {releaseTrack}
                      </span>
                    </td>
                    <td className="max-w-[160px] px-3 py-2 text-slate-400">
                      <span className="line-clamp-2">{t.artistsName || "—"}</span>
                    </td>
                    <td className="max-w-[140px] px-3 py-2 text-slate-400">
                      <span className="line-clamp-2">{t.labelName || "—"}</span>
                    </td>
                    <td className="max-w-[120px] px-3 py-2 text-slate-400">
                      <span className="line-clamp-2">{t.genre || "—"}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-500">{t.trackCreatedDate || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-500">{t.releaseCreatedDate || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {playingUrl && (
        <AudioPlayer
          title={playingUrl.title}
          artist={playingUrl.subtitle || " "}
          bpm={null}
          trackUrl={playingUrl.url}
          className="fixed bottom-4 right-4 z-50 w-[min(100vw-2rem,380px)] shadow-2xl"
          onClose={() => setPlayingUrl(null)}
          recommendContext={playingUrl.recommendContext}
          onRecommendPick={(pick: ZipdjRecommendPick) => {
            if (!pick.trackUrl) return;
            setPlayingUrl({
              url: pick.trackUrl,
              title: pick.releaseName,
              subtitle: pick.trackName || "",
              recommendContext: {
                releaseName: pick.releaseName,
                trackName: pick.trackName || null,
                artistsName: pick.artistsName,
                labelName: pick.labelName,
                genre: pick.genre,
                excludeTrackId: pick.trackId,
              },
            });
          }}
        />
      )}
    </div>
  );
}
