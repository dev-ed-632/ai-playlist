"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Radio, Sparkles } from "lucide-react";
import { AudioPlayer, type ZipdjRecommendPick } from "@/components/audio-player";
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

export default function ZipdjPromptPage() {
  const [promptText, setPromptText] = useState("");
  const [parsed, setParsed] = useState<ZipdjParsedPrompt | null>(null);
  const [tracks, setTracks] = useState<ZipdjRecTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [aiSdkDebug, setAiSdkDebug] = useState<unknown | null>(null);
  const [webGuessList, setWebGuessList] = useState<WebGuessRow[] | null>(null);
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

  async function runPrompt() {
    setError(null);
    setInfo(null);
    setAiSdkDebug(null);
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
      setAiSdkDebug(data.aiSdkWeb ?? null);
      const guess = data.webExtractedCandidates;
      setWebGuessList(Array.isArray(guess) ? guess : null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
      setParsed(null);
      setTracks([]);
      setAiSdkDebug(null);
      setWebGuessList(null);
    } finally {
      setLoading(false);
    }
  }

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
            href="/zipdj-catalog"
            className="text-xs font-semibold text-slate-500 underline-offset-2 hover:text-primary hover:underline"
          >
            Browse / filter catalog
          </Link>
        </div>

        <h1 className="mb-2 text-3xl font-black tracking-tight sm:text-4xl">ZipDJ prompt</h1>
        <p className="mb-8 max-w-2xl text-slate-400">
          Search the <code className="text-slate-300">zipdj_tracks_ai</code> table by vibe. Chart /
          trending asks use the{" "}
          <a
            href="https://ai-sdk.dev/"
            className="text-primary underline-offset-2 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Vercel AI SDK
          </a>{" "}
          with OpenAI Responses + <code className="text-slate-400">web_search_preview</code>,
          structured JSON, then nearest-neighbor match in your catalog (same 384-d embeddings).
          Matched tracks are shown in the same table layout as{" "}
          <Link href="/zipdj-catalog" className="text-primary underline-offset-2 hover:underline">
            ZipDJ catalog
          </Link>{" "}
          (release + track, artists, label, genre, dates).
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
              Structured chart list (AI SDK + web search)
            </h2>
            <p className="mb-3 text-xs text-slate-500">
              From <code className="text-slate-400">Output.object</code> after OpenAI web search
              (before vector match to <code className="text-slate-400">zipdj_tracks_ai</code>).
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
            No structured tracks returned (web search failed or model returned an empty list).
          </p>
        )}

        {aiSdkDebug != null && (
          <details className="mt-4 rounded-2xl border border-cyan-900/50 bg-slate-950/80 p-4 text-sm open:shadow-lg">
            <summary className="cursor-pointer font-semibold text-cyan-300/90 select-none">
              AI SDK web run (structured output + sources + model text)
            </summary>
            <pre className="mt-3 max-h-[min(70vh,560px)] overflow-auto rounded-xl border border-slate-800 bg-[#0a0f18] p-3 text-xs leading-relaxed text-slate-300 whitespace-pre-wrap break-words">
              {JSON.stringify(aiSdkDebug, null, 2)}
            </pre>
          </details>
        )}

        {(tracks.length > 0 || parsed || loading) && (
          <div className="mt-10">
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
              <span>
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                  </span>
                ) : (
                  <>
                    {tracks.length} result{tracks.length === 1 ? "" : "s"}
                    {parsed && (
                      <span className="text-slate-600">
                        {" "}
                        · {parsed.mode === "web_then_match" ? "web + vector match" : "vector match"}
                      </span>
                    )}
                  </>
                )}
              </span>
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
                  {loading && tracks.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-10 text-center text-slate-500">
                        <span className="inline-flex items-center justify-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                        </span>
                      </td>
                    </tr>
                  )}
                  {!loading && tracks.length === 0 && parsed && (
                    <tr>
                      <td colSpan={7} className="px-3 py-10 text-center text-slate-500">
                        No tracks matched. Add rows via Bulk ZipDJ CSV or widen your prompt.
                      </td>
                    </tr>
                  )}
                  {tracks.map((t) => {
                    const releaseTrack =
                      t.trackName?.trim() !== ""
                        ? `${t.releaseName} (${t.trackName})`
                        : t.releaseName;
                    return (
                      <tr
                        key={t.trackId}
                        className="border-b border-slate-800/80 last:border-0 hover:bg-slate-800/30"
                      >
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
                        <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                          {t.trackCreatedDate || "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                          {t.releaseCreatedDate || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
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
