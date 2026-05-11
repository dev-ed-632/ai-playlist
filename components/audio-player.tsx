"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import {
  ExternalLink,
  Loader2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

import { formatDuration } from "@/lib/client/format";
import { ensureYouTubeIframeApi } from "@/lib/client/youtube-iframe-api";
import { waveformFetchUrl } from "@/lib/shared/audio-proxy";
import { classifyTrackUrl, parseYouTubeVideoId } from "@/lib/shared/track-url";

import styles from "./audio-player.module.css";

/** ZipDJ catalog row context for “Recommend next” (optional). */
export type ZipdjRecommendContext = {
  releaseName: string;
  trackName: string | null;
  artistsName: string | null;
  labelName: string | null;
  genre?: string | null;
  excludeTrackId: string;
};

/** Row from `/api/zipdj/now-playing-recommend` — use to start playing a suggestion. */
export type ZipdjRecommendPick = {
  trackId: string;
  releaseName: string;
  trackName: string;
  trackUrl: string | null;
  artistsName: string | null;
  genre: string | null;
  labelName: string | null;
  trackCreatedDate: string | null;
  releaseCreatedDate: string | null;
};

export type AudioPlayerProps = {
  title: string;
  artist?: string;
  bpm?: number | null;
  trackUrl: string | null;
  className?: string;
  /** Dismiss the floating player (e.g. clear “now playing”). */
  onClose?: () => void;
  recommendContext?: ZipdjRecommendContext;
  /** Called when user plays a row from the recommend list. */
  onRecommendPick?: (t: ZipdjRecommendPick) => void;
};

function formatClock(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

const PROGRESS_HINT = "Drag the scrubber to seek";

const YT_ENDED = 0;
const YT_PLAYING = 1;
const YT_PAUSED = 2;

type YTPlayerInstance = {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead?: boolean): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  getCurrentTime(): number;
  getDuration(): number;
  destroy(): void;
  getPlayerState(): number;
};

type YouTubePlaybackProps = {
  youtubeId: string;
  trackUrl: string;
  title: string;
  artist?: string;
  bpm?: number | null;
  onClose?: () => void;
  recommendFooter?: ReactNode;
};

/** Thumbnail + scrubber like MP3; real playback via hidden IFrame API player. */
function YouTubePlaybackInner({
  youtubeId,
  trackUrl,
  title,
  artist,
  bpm,
  onClose,
  recommendFooter,
}: YouTubePlaybackProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayerInstance | null>(null);
  const [thumbSrc, setThumbSrc] = useState(`https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`);

  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;

    void ensureYouTubeIframeApi()
      .then(() => {
        if (cancelled || !hostRef.current) return;

        const win = window as unknown as {
          YT: { Player: new (el: HTMLElement, opts: object) => YTPlayerInstance };
        };

        const player = new win.YT.Player(hostRef.current, {
          videoId: youtubeId,
          width: 320,
          height: 180,
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            playsinline: 1,
            rel: 0,
            ...(typeof window !== "undefined" ? { origin: window.location.origin } : {}),
          },
          events: {
            onReady: (e: { target: YTPlayerInstance }) => {
              if (cancelled) return;
              const p = e.target;
              const d = p.getDuration();
              if (Number.isFinite(d) && d > 0) setDuration(d);
              setIsReady(true);
              setIsMuted(p.isMuted());
            },
            onStateChange: (e: { data: number }) => {
              if (cancelled) return;
              if (e.data === YT_PLAYING) setIsPlaying(true);
              if (e.data === YT_PAUSED) setIsPlaying(false);
              if (e.data === YT_ENDED) {
                setIsPlaying(false);
                setCurrentTime(0);
              }
            },
            onError: (e: { data: number }) => {
              if (cancelled) return;
              const code = e.data;
              let msg = "Could not load this YouTube preview.";
              if (code === 101 || code === 150) {
                msg = "This video can’t be embedded here. Open it on YouTube instead.";
              }
              setLoadError(msg);
              setIsReady(false);
            },
          },
        });

        playerRef.current = player;
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError("Could not load the YouTube player.");
          setIsReady(false);
        }
      });

    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
    };
  }, [youtubeId]);

  useEffect(() => {
    if (!isReady) return;
    const id = window.setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      try {
        const st = p.getPlayerState();
        if (st === YT_PLAYING || st === YT_PAUSED) {
          setCurrentTime(p.getCurrentTime());
        }
        const d = p.getDuration();
        if (Number.isFinite(d) && d > 0) {
          setDuration((prev) => (Math.abs(prev - d) > 0.5 ? d : prev));
        }
      } catch {
        /* destroyed */
      }
    }, 250);
    return () => clearInterval(id);
  }, [isReady]);

  const controlsDisabled = !isReady || !!loadError;

  function skipBackward() {
    const p = playerRef.current;
    if (!p) return;
    p.seekTo(Math.max(0, p.getCurrentTime() - 5), true);
  }

  function skipForward() {
    const p = playerRef.current;
    if (!p || !duration) return;
    p.seekTo(Math.min(duration, p.getCurrentTime() + 5), true);
  }

  function togglePlayback() {
    const p = playerRef.current;
    if (!p) return;
    const st = p.getPlayerState();
    if (st === YT_PLAYING) {
      p.pauseVideo();
    } else {
      p.playVideo();
    }
  }

  function toggleMute() {
    const p = playerRef.current;
    if (!p) return;
    if (p.isMuted()) {
      p.unMute();
    } else {
      p.mute();
    }
    setIsMuted(p.isMuted());
  }

  function onSeek(v: number) {
    const p = playerRef.current;
    if (!p || !isReady) return;
    p.seekTo(v, true);
    setCurrentTime(v);
  }

  return (
    <>
      <div ref={hostRef} className={styles.ytPlayerHost} aria-hidden="true" />

      <div className={styles.header}>
        <div className={styles.trackBlock}>
          <p className={styles.eyebrow}>Playback</p>
          <p className={styles.trackName}>{title}</p>
          {artist ? <p className={styles.artistLine}>{artist}</p> : null}
          <div className={styles.metaInline}>
            <span>Stream</span>
            {bpm != null && bpm > 0 ? <span>{bpm} BPM</span> : null}
            {isReady && duration > 0 ? <span>{formatDuration(duration)}</span> : null}
          </div>
        </div>
        <div className={styles.headerAside}>
          {onClose ? (
            <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close player">
              <X className={styles.icon} />
            </button>
          ) : null}
          <p className={styles.timing}>
            {isReady ? (
              <>
                {formatClock(currentTime)} / {formatClock(duration)}
              </>
            ) : (
              <span className={styles.timingMuted}>—</span>
            )}
          </p>
        </div>
      </div>

      <div className={styles.wave}>
        {loadError ? (
          <>
            <p className={styles.loadError}>{loadError}</p>
            <a className={styles.externalLink} href={trackUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className={styles.icon} aria-hidden />
              Open on YouTube
            </a>
          </>
        ) : (
          <div className={styles.progressWrap}>
            <div className={styles.thumbRow}>
              {/* YouTube thumbs: external + fallback src — next/image adds hostname config */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbSrc}
                alt=""
                className={styles.thumbArt}
                onError={() => setThumbSrc(`https://i.ytimg.com/vi/${youtubeId}/mqdefault.jpg`)}
              />
            </div>
            <p className={styles.progressHint}>{PROGRESS_HINT}</p>
            <input
              type="range"
              className={styles.progressRange}
              min={0}
              max={duration > 0 ? duration : 100}
              step={0.1}
              value={duration > 0 ? Math.min(currentTime, duration) : 0}
              disabled={controlsDisabled}
              aria-label="Seek"
              onChange={(e) => onSeek(parseFloat(e.target.value))}
            />
            <a className={styles.externalLink} href={trackUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className={styles.icon} aria-hidden />
              Open on YouTube
            </a>
          </div>
        )}
      </div>

      <div className={styles.controls}>
        <div className={styles.transportGroup}>
          <button className={styles.iconButton} type="button" onClick={skipBackward} disabled={controlsDisabled}>
            <SkipBack className={styles.icon} />
          </button>
          <button
            className={`${styles.control} ${styles.primary}`}
            type="button"
            onClick={togglePlayback}
            disabled={controlsDisabled}
          >
            {isPlaying ? <Pause className={styles.icon} /> : <Play className={styles.icon} />}
            <span>{isPlaying ? "Pause" : "Play"}</span>
          </button>
          <button className={styles.iconButton} type="button" onClick={skipForward} disabled={controlsDisabled}>
            <SkipForward className={styles.icon} />
          </button>
        </div>

        {recommendFooter}

        <button className={styles.control} type="button" onClick={toggleMute} disabled={controlsDisabled}>
          {isMuted ? <VolumeX className={styles.icon} /> : <Volume2 className={styles.icon} />}
          <span>{isMuted ? "Unmute" : "Mute"}</span>
        </button>
      </div>
    </>
  );
}

function YouTubePlayback(props: YouTubePlaybackProps) {
  return <YouTubePlaybackInner key={props.youtubeId} {...props} />;
}

type DirectAudioProps = {
  trackUrl: string;
  title: string;
  artist?: string;
  bpm?: number | null;
  onClose?: () => void;
  recommendFooter?: ReactNode;
};

type DirectAudioInnerProps = {
  playUrl: string;
  trackUrl: string;
  title: string;
  artist?: string;
  bpm?: number | null;
  onClose?: () => void;
  recommendFooter?: ReactNode;
};

/** Remounted via parent `key` so initial state resets without effect setState. */
function DirectAudioPlaybackInner({
  playUrl,
  trackUrl,
  title,
  artist,
  bpm,
  onClose,
  recommendFooter,
}: DirectAudioInnerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const syncDuration = () => {
      if (Number.isFinite(a.duration) && a.duration > 0) {
        setDuration(a.duration);
        setIsReady(true);
      }
    };

    const onTimeUpdate = () => setCurrentTime(a.currentTime);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const onError = () => {
      setLoadError("Could not load audio. Check the link or try opening it externally.");
      setIsReady(false);
    };

    a.addEventListener("loadedmetadata", syncDuration);
    a.addEventListener("durationchange", syncDuration);
    a.addEventListener("canplay", syncDuration);
    a.addEventListener("timeupdate", onTimeUpdate);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);
    a.addEventListener("error", onError);

    a.src = playUrl;
    a.muted = false;
    a.load();

    return () => {
      a.pause();
      a.removeEventListener("loadedmetadata", syncDuration);
      a.removeEventListener("durationchange", syncDuration);
      a.removeEventListener("canplay", syncDuration);
      a.removeEventListener("timeupdate", onTimeUpdate);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("error", onError);
      a.removeAttribute("src");
      a.load();
    };
  }, [playUrl]);

  const controlsDisabled = !isReady || !!loadError;

  function skipBackward() {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, a.currentTime - 5);
  }

  function skipForward() {
    const a = audioRef.current;
    if (!a || !duration) return;
    a.currentTime = Math.min(duration, a.currentTime + 5);
  }

  function togglePlayback() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      void a.play().catch(() => {
        setLoadError("Playback was blocked or failed. Try again or open the link in a new tab.");
      });
    } else {
      a.pause();
    }
  }

  function toggleMute() {
    const a = audioRef.current;
    if (!a) return;
    const next = !a.muted;
    a.muted = next;
    setIsMuted(next);
  }

  function onSeek(v: number) {
    const a = audioRef.current;
    if (!a || !isReady) return;
    a.currentTime = v;
    setCurrentTime(v);
  }

  return (
    <>
      <audio ref={audioRef} className={styles.hiddenAudio} playsInline preload="auto" />

      <div className={styles.header}>
        <div className={styles.trackBlock}>
          <p className={styles.eyebrow}>Playback</p>
          <p className={styles.trackName}>{title}</p>
          {artist ? <p className={styles.artistLine}>{artist}</p> : null}
          <div className={styles.metaInline}>
            <span>Stream</span>
            {bpm != null && bpm > 0 ? <span>{bpm} BPM</span> : null}
            {isReady && duration > 0 ? <span>{formatDuration(duration)}</span> : null}
          </div>
        </div>
        <div className={styles.headerAside}>
          {onClose ? (
            <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close player">
              <X className={styles.icon} />
            </button>
          ) : null}
          <p className={styles.timing}>
            {isReady ? (
              <>
                {formatClock(currentTime)} / {formatClock(duration)}
              </>
            ) : (
              <span className={styles.timingMuted}>—</span>
            )}
          </p>
        </div>
      </div>

      <div className={styles.wave}>
        {loadError ? (
          <>
            <p className={styles.loadError}>{loadError}</p>
            <a className={styles.externalLink} href={trackUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className={styles.icon} aria-hidden />
              Open audio URL
            </a>
          </>
        ) : (
          <div className={styles.progressWrap}>
            <p className={styles.progressHint}>{PROGRESS_HINT}</p>
            <input
              type="range"
              className={styles.progressRange}
              min={0}
              max={duration > 0 ? duration : 100}
              step={0.05}
              value={duration > 0 ? Math.min(currentTime, duration) : 0}
              disabled={controlsDisabled}
              aria-label="Seek"
              onChange={(e) => onSeek(parseFloat(e.target.value))}
            />
          </div>
        )}
      </div>

      <div className={styles.controls}>
        <div className={styles.transportGroup}>
          <button className={styles.iconButton} type="button" onClick={skipBackward} disabled={controlsDisabled}>
            <SkipBack className={styles.icon} />
          </button>
          <button
            className={`${styles.control} ${styles.primary}`}
            type="button"
            onClick={togglePlayback}
            disabled={controlsDisabled}
          >
            {isPlaying ? <Pause className={styles.icon} /> : <Play className={styles.icon} />}
            <span>{isPlaying ? "Pause" : "Play"}</span>
          </button>
          <button className={styles.iconButton} type="button" onClick={skipForward} disabled={controlsDisabled}>
            <SkipForward className={styles.icon} />
          </button>
        </div>

        {recommendFooter}

        <button className={styles.control} type="button" onClick={toggleMute} disabled={controlsDisabled}>
          {isMuted ? <VolumeX className={styles.icon} /> : <Volume2 className={styles.icon} />}
          <span>{isMuted ? "Unmute" : "Mute"}</span>
        </button>
      </div>
    </>
  );
}

/** Native audio + proxy URL; wrapper sets `key` so track switches remount clean state. */
function DirectAudioPlayback({
  trackUrl,
  title,
  artist,
  bpm,
  onClose,
  recommendFooter,
}: DirectAudioProps) {
  const playUrl = waveformFetchUrl(trackUrl);
  return (
    <DirectAudioPlaybackInner
      key={trackUrl}
      playUrl={playUrl}
      trackUrl={trackUrl}
      title={title}
      artist={artist}
      bpm={bpm}
      onClose={onClose}
      recommendFooter={recommendFooter}
    />
  );
}

function ZipdjRecommendHost({
  recommendContext,
  onRecommendPick,
  floatingClassName,
  renderPlayer,
}: {
  recommendContext: ZipdjRecommendContext;
  onRecommendPick?: (t: ZipdjRecommendPick) => void;
  floatingClassName?: string;
  renderPlayer: (recommendFooter: ReactNode) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [tracks, setTracks] = useState<ZipdjRecommendPick[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    setExpanded(false);
    setTracks([]);
    setError(null);
    setInfo(null);
  }, [recommendContext.excludeTrackId]);

  const fetchRecommendations = useCallback(async () => {
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/zipdj/now-playing-recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          releaseName: recommendContext.releaseName,
          trackName: recommendContext.trackName ?? "",
          artistsName: recommendContext.artistsName ?? "",
          labelName: recommendContext.labelName ?? "",
          genre: recommendContext.genre ?? "",
          excludeTrackId: recommendContext.excludeTrackId,
        }),
      });
      const data = (await res.json()) as {
        tracks?: ZipdjRecommendPick[];
        message?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Request failed");
      setTracks(Array.isArray(data.tracks) ? data.tracks : []);
      if (data.message?.trim()) setInfo(data.message.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load suggestions");
      setTracks([]);
    } finally {
      setLoading(false);
    }
  }, [recommendContext]);

  function onRecommendClick() {
    setExpanded((prev) => {
      if (!prev) void fetchRecommendations();
      return !prev;
    });
  }

  const footer = (
    <button
      type="button"
      className={clsx(styles.control, expanded && styles.recommendBtnActive)}
      onClick={onRecommendClick}
      aria-expanded={expanded}
    >
      <Sparkles className={styles.icon} />
      <span>{expanded ? "Hide" : "Recommend"}</span>
    </button>
  );

  return (
    <div
      className={clsx(styles.zipdjRecommendShell, expanded && styles.zipdjRecommendShellExpanded)}
    >
      <div className={styles.zipdjRecommendPlayerWrap}>
        <article
          className={clsx(
            styles.playerCard,
            !expanded && floatingClassName,
            expanded && styles.playerCardDocked
          )}
        >
          {renderPlayer(footer)}
        </article>
      </div>
      {expanded ? (
        <div className={styles.recommendPanel}>
          <div className={styles.recommendPanelHeader}>
            <p className={styles.recommendPanelTitle}>Suggested next</p>
            {loading ? (
              <span className={styles.timingMuted} aria-hidden>
                <Loader2 className={styles.spinIcon} />
              </span>
            ) : null}
          </div>
          {error ? <p className={styles.loadError}>{error}</p> : null}
          {info && !error ? <p className={styles.progressHint}>{info}</p> : null}
          <div className={styles.recommendTableWrap}>
            <table className={styles.recommendTable}>
              <thead>
                <tr>
                  <th>Play</th>
                  <th>Release (track)</th>
                  <th>Artists</th>
                  <th>Label</th>
                  <th>Genre</th>
                </tr>
              </thead>
              <tbody>
                {!loading && tracks.length === 0 ? (
                  <tr>
                    <td colSpan={5} className={styles.timingMuted} style={{ padding: "0.85rem" }}>
                      No suggestions yet.
                    </td>
                  </tr>
                ) : null}
                {tracks.map((t) => {
                  const releaseTrack =
                    t.trackName?.trim() !== "" ? `${t.releaseName} (${t.trackName})` : t.releaseName;
                  return (
                    <tr key={t.trackId}>
                      <td>
                        {t.trackUrl ? (
                          <button
                            type="button"
                            className={styles.recommendPlayLink}
                            onClick={() => onRecommendPick?.(t)}
                          >
                            Play
                          </button>
                        ) : (
                          <span className={styles.timingMuted}>—</span>
                        )}
                      </td>
                      <td>{releaseTrack}</td>
                      <td>{t.artistsName || "—"}</td>
                      <td>{t.labelName || "—"}</td>
                      <td>{t.genre || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AudioPlayer({
  title,
  artist,
  bpm,
  trackUrl,
  className,
  onClose,
  recommendContext,
  onRecommendPick,
}: AudioPlayerProps) {
  const youtubeId = parseYouTubeVideoId(trackUrl);
  const kind = youtubeId ? "youtube" : classifyTrackUrl(trackUrl);

  if (recommendContext) {
    return (
      <ZipdjRecommendHost
        recommendContext={recommendContext}
        onRecommendPick={onRecommendPick}
        floatingClassName={className}
        renderPlayer={(footer) => {
          if (kind === "youtube" && youtubeId) {
            const ytHref = trackUrl ?? `https://www.youtube.com/watch?v=${youtubeId}`;
            return (
              <YouTubePlayback
                youtubeId={youtubeId}
                trackUrl={ytHref}
                title={title}
                artist={artist}
                bpm={bpm}
                onClose={onClose}
                recommendFooter={footer}
              />
            );
          }
          if (kind === "audio" && trackUrl?.trim()) {
            return (
              <DirectAudioPlayback
                trackUrl={trackUrl.trim()}
                title={title}
                artist={artist}
                bpm={bpm}
                onClose={onClose}
                recommendFooter={footer}
              />
            );
          }
          return (
            <>
              <div className={styles.header}>
                <div className={styles.trackBlock}>
                  <p className={styles.eyebrow}>Playback</p>
                  <p className={styles.trackName}>{title}</p>
                  {artist ? <p className={styles.artistLine}>{artist}</p> : null}
                  <div className={styles.metaInline}>
                    <span>No preview</span>
                    {bpm != null && bpm > 0 ? <span>{bpm} BPM</span> : null}
                  </div>
                </div>
                <div className={styles.headerAside}>
                  {onClose ? (
                    <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close player">
                      <X className={styles.icon} />
                    </button>
                  ) : null}
                  <p className={styles.timing}>
                    <span className={styles.timingMuted}>—</span>
                  </p>
                </div>
              </div>

              <div className={styles.wave}>
                <p className={styles.noPreview}>No preview URL for this track.</p>
              </div>

              <div className={styles.controls}>
                <div className={styles.transportGroup} />
                {footer}
              </div>
            </>
          );
        }}
      />
    );
  }

  if (kind === "youtube" && youtubeId) {
    const ytHref = trackUrl ?? `https://www.youtube.com/watch?v=${youtubeId}`;
    return (
      <article className={clsx(styles.playerCard, className)}>
        <YouTubePlayback
          youtubeId={youtubeId}
          trackUrl={ytHref}
          title={title}
          artist={artist}
          bpm={bpm}
          onClose={onClose}
        />
      </article>
    );
  }

  if (kind === "audio" && trackUrl?.trim()) {
    return (
      <article className={clsx(styles.playerCard, className)}>
        <DirectAudioPlayback trackUrl={trackUrl.trim()} title={title} artist={artist} bpm={bpm} onClose={onClose} />
      </article>
    );
  }

  return (
    <article className={clsx(styles.playerCard, className)}>
      <div className={styles.header}>
        <div className={styles.trackBlock}>
          <p className={styles.eyebrow}>Playback</p>
          <p className={styles.trackName}>{title}</p>
          {artist ? <p className={styles.artistLine}>{artist}</p> : null}
          <div className={styles.metaInline}>
            <span>No preview</span>
            {bpm != null && bpm > 0 ? <span>{bpm} BPM</span> : null}
          </div>
        </div>
        <div className={styles.headerAside}>
          {onClose ? (
            <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close player">
              <X className={styles.icon} />
            </button>
          ) : null}
          <p className={styles.timing}>
            <span className={styles.timingMuted}>—</span>
          </p>
        </div>
      </div>

      <div className={styles.wave}>
        <p className={styles.noPreview}>No preview URL for this track.</p>
      </div>
    </article>
  );
}
