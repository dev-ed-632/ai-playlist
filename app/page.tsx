import Link from "next/link";
import { Search, UploadCloud, Sparkles, Radio, ListMusic, MessageSquareText, FileSpreadsheet } from "lucide-react";
import { APP_CONFIG } from "@/config/app-theme";

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#070b14] text-slate-100">
      {/* Ambient bg */}
      <div className="pointer-events-none absolute inset-0 opacity-35">
        <div className="absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-primary/25 blur-[120px]" />
        <div className="absolute bottom-0 left-0 h-72 w-72 rounded-full bg-primary/15 blur-[100px]" />
      </div>

      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-14 px-6 py-16 sm:px-10 sm:py-20">
        {/* Hero */}
        <section className="grid items-center gap-10 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-primary">
              <Radio className="h-3.5 w-3.5" />
              {APP_CONFIG.projectName}
            </div>

            <div className="space-y-4">
              <h1 className="text-4xl font-black leading-[0.95] tracking-tight sm:text-6xl">
                AI playlist tooling
                <span className="mt-2 block text-primary">for live set architects</span>
              </h1>
              <p className="max-w-2xl text-base text-slate-300 sm:text-lg">
                Generate event-driven playlists, search by vibe, and ingest tracks with embeddings.
                All flows run on your shared theme and smart recommendation pipeline.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/prompt-playlist"
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-white shadow-[0_10px_35px_rgba(0,87,193,0.35)] transition hover:brightness-110"
              >
                <MessageSquareText className="h-4 w-4" />
                Prompt playlist
              </Link>
              <Link
                href="/zipdj-prompt"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-900/80 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:border-primary/50 hover:text-white"
              >
                <MessageSquareText className="h-4 w-4" />
                ZipDJ prompt
              </Link>
              <Link
                href="/create-playlist"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/70 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:border-primary/50 hover:text-white"
              >
                <Sparkles className="h-4 w-4" />
                Energy curve playlist
              </Link>
              <Link
                href="/search"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/70 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:border-primary/50 hover:text-white"
              >
                <Search className="h-4 w-4" />
                Search Tracks
              </Link>
              <Link
                href="/browse"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/70 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:border-primary/50 hover:text-white"
              >
                <ListMusic className="h-4 w-4" />
                Browse library
              </Link>
            </div>
          </div>

          {/* Animated DJ panel */}
          <div className="relative rounded-3xl border border-slate-800/80 bg-[#0b1220]/85 p-6 shadow-2xl">
            <div className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
              DJ Booth Preview
            </div>
            <svg viewBox="0 0 420 180" className="h-auto w-full" aria-hidden>
              <defs>
                <linearGradient id="djGlow" x1="0%" x2="100%" y1="0%" y2="0%">
                  <stop offset="0%" stopColor={APP_CONFIG.theme.primary} stopOpacity="0.2" />
                  <stop offset="50%" stopColor={APP_CONFIG.theme.primary} stopOpacity="1" />
                  <stop offset="100%" stopColor={APP_CONFIG.theme.primary} stopOpacity="0.2" />
                </linearGradient>
              </defs>
              {/* Deck base */}
              <rect x="30" y="20" width="360" height="130" rx="18" fill="#0a1427" stroke="#1e2a44" />

              {/* Left platter */}
              <g transform="translate(130 86)">
                <circle r="42" fill="#08101f" stroke="#1d355e" />
                <circle r="31" fill="none" stroke="#27487c" />
                <circle r="9" fill={APP_CONFIG.theme.primary} />
                <g stroke="url(#djGlow)" strokeWidth="2.2" strokeLinecap="round">
                  <line x1="-28" y1="0" x2="-37" y2="0">
                    <animateTransform
                      attributeName="transform"
                      type="rotate"
                      from="0 0 0"
                      to="360 0 0"
                      dur="2.2s"
                      repeatCount="indefinite"
                    />
                  </line>
                  <line x1="28" y1="0" x2="37" y2="0">
                    <animateTransform
                      attributeName="transform"
                      type="rotate"
                      from="0 0 0"
                      to="360 0 0"
                      dur="2.2s"
                      repeatCount="indefinite"
                    />
                  </line>
                </g>
                <circle r="42" fill="none" stroke="url(#djGlow)" opacity="0.35">
                  <animateTransform
                    attributeName="transform"
                    type="rotate"
                    from="0 0 0"
                    to="360 0 0"
                    dur="2.2s"
                    repeatCount="indefinite"
                  />
                </circle>
              </g>

              {/* Right platter */}
              <g transform="translate(288 86)">
                <circle r="36" fill="#08101f" stroke="#1d355e" />
                <circle r="25" fill="none" stroke="#27487c" />
                <circle r="8" fill={APP_CONFIG.theme.primary} />
                <circle r="36" fill="none" stroke="url(#djGlow)" opacity="0.35">
                  <animateTransform
                    attributeName="transform"
                    type="rotate"
                    from="360 0 0"
                    to="0 0 0"
                    dur="2.8s"
                    repeatCount="indefinite"
                  />
                </circle>
              </g>

              {/* Mixer bars */}
              {[188, 203, 218].map((x, i) => (
                <rect key={x} x={x} y="48" width="6" height="62" rx="3" fill="#1b2f52">
                  <animate
                    attributeName="y"
                    values={`${48 + i * 4};${70 - i * 6};${52 + i * 2};${48 + i * 4}`}
                    dur={`${1.6 + i * 0.3}s`}
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="height"
                    values={`${62 - i * 4};${40 + i * 8};${58 - i * 3};${62 - i * 4}`}
                    dur={`${1.6 + i * 0.3}s`}
                    repeatCount="indefinite"
                  />
                </rect>
              ))}
            </svg>
          </div>
        </section>

        {/* Action cards */}
        <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          <Link
            href="/prompt-playlist"
            className="group rounded-2xl border border-primary/45 bg-primary/10 p-6 transition hover:-translate-y-0.5 hover:bg-primary/15"
          >
            <MessageSquareText className="mb-4 h-6 w-6 text-primary" />
            <h2 className="text-xl font-bold">Prompt playlist</h2>
            <p className="mt-2 text-sm text-slate-300">
              Natural-language brief, LLM-parsed filters, 30–50 catalog picks.
            </p>
          </Link>
          <Link
            href="/create-playlist"
            className="group rounded-2xl border border-slate-700/70 bg-slate-900/60 p-6 transition hover:-translate-y-0.5 hover:border-primary/45"
          >
            <Sparkles className="mb-4 h-6 w-6 text-primary" />
            <h2 className="text-xl font-bold">Energy curve playlist</h2>
            <p className="mt-2 text-sm text-slate-300">
              Structured sets by event type, genres, and segment energy flow.
            </p>
          </Link>

          <Link
            href="/search"
            className="group rounded-2xl border border-slate-700/70 bg-slate-900/60 p-6 transition hover:-translate-y-0.5 hover:border-primary/45"
          >
            <Search className="mb-4 h-6 w-6 text-primary" />
            <h2 className="text-xl font-bold">Search Mode</h2>
            <p className="mt-2 text-sm text-slate-300">
              Explore similar songs and navigate related recommendations.
            </p>
          </Link>

          <Link
            href="/browse"
            className="group rounded-2xl border border-slate-700/70 bg-slate-900/60 p-6 transition hover:-translate-y-0.5 hover:border-primary/45"
          >
            <ListMusic className="mb-4 h-6 w-6 text-primary" />
            <h2 className="text-xl font-bold">Browse library</h2>
            <p className="mt-2 text-sm text-slate-300">
              Filter by metadata, source type, BPM, label, and key.
            </p>
          </Link>

          <Link
            href="/creator/upload"
            className="group rounded-2xl border border-slate-700/70 bg-slate-900/60 p-6 transition hover:-translate-y-0.5 hover:border-primary/45"
          >
            <UploadCloud className="mb-4 h-6 w-6 text-primary" />
            <h2 className="text-xl font-bold">Song Ingestion</h2>
            <p className="mt-2 text-sm text-slate-300">
              Extract features and insert embeddings — or use bulk CSV with URLs.
            </p>
          </Link>

          <Link
            href="/creator/bulk-zipdj-csv"
            className="group rounded-2xl border border-slate-700/70 bg-slate-900/60 p-6 transition hover:-translate-y-0.5 hover:border-primary/45"
          >
            <FileSpreadsheet className="mb-4 h-6 w-6 text-primary" />
            <h2 className="text-xl font-bold">Bulk ZipDJ CSV</h2>
            <p className="mt-2 text-sm text-slate-300">
              Ingest ZipDJ metadata and embeddings into zipdj_tracks_ai (no audio decode).
            </p>
          </Link>
        </section>
      </div>
    </div>
  );
}
