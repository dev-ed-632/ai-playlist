"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Radio, Sparkles } from "lucide-react";
import { AudioPlayer } from "@/components/audio-player";
import type { ZipdjParsedPrompt } from "@/lib/types/zipdj-prompt";

type WebGuessRow = {
  title: string;
  artist: string | null;
};

type ZipdjRecTrack = {
  trackId: string;
  releaseName: string;
  trackName: string;
  trackUrl: string | null;
  artistsName: string | null;
  genre: string | null;
  tags: string | null;
  labelName: string | null;
  labelId: string | null;
  releaseId: string | null;
  trackCreatedDate: string | null;
  releaseCreatedDate: string | null;
  source: "web" | "vector";
  vecDist?: number;
};

function groupKey(t: ZipdjRecTrack): string {
  const id = t.releaseId?.trim();
  if (id) return `id:${id}`;
  return `name:${(t.releaseName || t.trackId).toLowerCase()}`;
}

export default function ZipdjPromptPage() {
  const [promptText, setPromptText] = useState("");
  const [parsed, setParsed] = useState<ZipdjParsedPrompt | null>(null);
  const [tracks, setTracks] = useState<ZipdjRecTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [tavilyRaw, setTavilyRaw] = useState<unknown | null>(null);
  const [webGuessList, setWebGuessList] = useState<WebGuessRow[] | null>(null);
  const [playingUrl, setPlayingUrl] = useState<{
    url: string;
    title: string;
    subtitle: string;
  } | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, ZipdjRecTrack[]>();
    for (const t of tracks) {
      const k = groupKey(t);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(t);
    }
    return Array.from(map.entries());
  }, [tracks]);

  async function runPrompt() {
    setError(null);
    setInfo(null);
    setTavilyRaw(null);
    setWebGuessList(null);
    if (!promptText.trim()) {
      setError("Enter a prompt.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/zipdj/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: promptText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setParsed(data.parsed ?? null);
      setTracks(data.tracks ?? []);
      if (data.message) setInfo(data.message);
      setTavilyRaw(data.tavilyResponse ?? null);
      const guess = data.webExtractedCandidates;
      setWebGuessList(Array.isArray(guess) ? guess : null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
      setParsed(null);
      setTracks([]);
      setTavilyRaw(null);
      setWebGuessList(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100">
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>

        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/35 bg-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
          <Radio className="h-3.5 w-3.5" />
          ZipDJ catalog
        </div>

        <h1 className="mb-2 text-3xl font-black tracking-tight sm:text-4xl">ZipDJ prompt</h1>
        <p className="mb-8 max-w-2xl text-slate-400">
          Search the <code className="text-slate-300">zipdj_tracks_ai</code> table by vibe. Trending
          or chart-style asks use web search (Tavily) when configured, then match titles to your
          catalog. Display uses <strong className="font-semibold text-slate-200">release</strong> as
          the song title and <strong className="font-semibold text-slate-200">mix</strong> as the
          version line.
        </p>

        {error && (
          <div className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}
        {info && (
          <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            {info}
          </div>
        )}

        <div className="space-y-4">
          <textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            rows={7}
            placeholder='e.g. "Melodic house for a sunset lounge" or "Top 10 trending dance tracks on Spotify right now"'
            className="w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:border-primary focus:outline-none"
          />
          <button
            type="button"
            disabled={loading}
            onClick={() => void runPrompt()}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Run prompt
          </button>
        </div>

        {parsed && (
          <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-400">
            <span className="font-semibold text-slate-300">Router:</span> {parsed.mode} ·{" "}
            <span className="font-semibold text-slate-300">Count:</span> {parsed.requested_count}
            {parsed.mode === "web_then_match" && parsed.web_query && (
              <>
                {" "}
                · <span className="font-semibold text-slate-300">Web query:</span> {parsed.web_query}
              </>
            )}
          </div>
        )}

        {webGuessList != null && webGuessList.length > 0 && (
          <div className="mt-4 rounded-2xl border border-violet-900/40 bg-slate-900/60 p-4">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-violet-300/90">
              OpenAI — titles guessed from Tavily snippets
            </h2>
            <p className="mb-3 text-xs text-slate-500">
              Parsed by your LLM from the combined Tavily text (before matching{" "}
              <code className="text-slate-400">zipdj_tracks_ai</code>). Order is model-defined
              “most relevant first.”
            </p>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-200">
              {webGuessList.map((g, i) => (
                <li key={`${g.title}-${i}`}>
                  <span className="font-medium">{g.title}</span>
                  {g.artist != null && g.artist !== "" ? (
                    <span className="text-slate-400"> — {g.artist}</span>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        )}

        {parsed?.mode === "web_then_match" && webGuessList != null && webGuessList.length === 0 && (
          <p className="mt-4 text-xs text-slate-500">
            No OpenAI-extracted titles (web failed before extraction or extractor returned an empty
            list).
          </p>
        )}

        {tavilyRaw != null && (
          <details className="mt-4 rounded-2xl border border-cyan-900/50 bg-slate-950/80 p-4 text-sm open:shadow-lg">
            <summary className="cursor-pointer font-semibold text-cyan-300/90 select-none">
              Tavily API response (raw JSON)
            </summary>
            <pre className="mt-3 max-h-[min(70vh,560px)] overflow-auto rounded-xl border border-slate-800 bg-[#0a0f18] p-3 text-xs leading-relaxed text-slate-300 whitespace-pre-wrap break-words">
              {JSON.stringify(tavilyRaw, null, 2)}
            </pre>
          </details>
        )}

        {tracks.length > 0 && (
          <div className="mt-10 space-y-8">
            <p className="text-sm text-slate-500">
              {tracks.length} result{tracks.length === 1 ? "" : "s"} · {grouped.length} release
              {grouped.length === 1 ? "" : "s"}
            </p>

            {grouped.map(([key, group]) => {
              const head = group[0];
              return (
                <section
                  key={key}
                  className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5"
                >
                  <h2 className="text-lg font-bold text-white">{head.releaseName}</h2>
                  {head.artistsName && (
                    <p className="mt-1 text-sm text-slate-400">{head.artistsName}</p>
                  )}
                  <ul className="mt-4 space-y-3">
                    {group.map((t) => (
                      <li
                        key={t.trackId}
                        className="flex flex-wrap items-start justify-between gap-3 border-t border-slate-800/80 pt-3 first:border-t-0 first:pt-0"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-200">
                            {t.trackName?.trim() ? t.trackName : "Default mix"}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                            {t.releaseCreatedDate && (
                              <span title="release_created_date">rel {t.releaseCreatedDate}</span>
                            )}
                            {t.trackCreatedDate && (
                              <span title="track_created_date">trk {t.trackCreatedDate}</span>
                            )}
                            {t.genre && <span>{t.genre}</span>}
                            {t.labelName && <span>{t.labelName}</span>}
                            <span
                              className={
                                t.source === "web" ? "text-emerald-400/90" : "text-slate-500"
                              }
                            >
                              {t.source === "web" ? "web match" : "similarity"}
                            </span>
                            {t.vecDist != null && (
                              <span className="text-slate-600">Δ{t.vecDist}</span>
                            )}
                          </div>
                        </div>
                        {t.trackUrl && (
                          <button
                            type="button"
                            onClick={() =>
                              setPlayingUrl({
                                url: t.trackUrl!,
                                title: head.releaseName,
                                subtitle: t.trackName || "",
                              })
                            }
                            className="shrink-0 text-xs font-bold uppercase tracking-wide text-primary hover:underline"
                          >
                            Play
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}

        {parsed && tracks.length === 0 && !loading && (
          <p className="mt-8 text-slate-500">No tracks matched. Add rows via Bulk ZipDJ CSV or widen your prompt.</p>
        )}
      </div>

      {playingUrl && (
        <AudioPlayer
          title={playingUrl.title}
          artist={playingUrl.subtitle || " "}
          bpm={null}
          trackUrl={playingUrl.url}
          className="fixed bottom-4 right-4 z-50 w-[min(100vw-2rem,380px)] shadow-2xl"
          onClose={() => setPlayingUrl(null)}
        />
      )}
    </div>
  );
}
