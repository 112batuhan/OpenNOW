import { Clapperboard, Search, RefreshCw, Clock3, Cpu, X, Image as ImageIcon, Video, Rewind, Scissors } from "lucide-react";
import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ClipRecord, ClipRecordInput } from "@shared/gfn";

export interface ClipsPageProps {
  clips: ClipRecord[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onRefresh: () => void;
}

const WASM_ADD_FALLBACK = (a: number, b: number): number => a + b;
const WASM_ADD_BYTES = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 7, 1, 96, 2, 127, 127, 1, 127, 3, 2, 1, 0, 7, 7, 1, 3, 97, 100, 100, 0, 0, 10,
  9, 1, 7, 0, 32, 0, 32, 1, 106, 11,
]);
let wasmAddPromise: Promise<(a: number, b: number) => number> | null = null;

function getWasmAdd(): Promise<(a: number, b: number) => number> {
  if (!wasmAddPromise) {
    wasmAddPromise = WebAssembly.instantiate(WASM_ADD_BYTES)
      .then((module) => {
        const add = (module.instance.exports as { add?: unknown }).add;
        return typeof add === "function" ? (add as (a: number, b: number) => number) : WASM_ADD_FALLBACK;
      })
      .catch(() => WASM_ADD_FALLBACK);
  }
  return wasmAddPromise;
}

function getPreferredEditorMimeType(): string {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }
  const preferred = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return preferred.find((mime) => MediaRecorder.isTypeSupported(mime)) ?? "";
}

function formatTimestamp(timestampMs: number): string {
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleString();
}

function clipTypeLabel(type: ClipRecord["clipType"]): string {
  if (type === "instant-replay") return "Instant Replay";
  if (type === "manual-recording") return "Recording";
  return "Screenshot";
}

function clipTypeIcon(type: ClipRecord["clipType"]): JSX.Element {
  if (type === "instant-replay") return <Rewind size={12} />;
  if (type === "manual-recording") return <Video size={12} />;
  return <ImageIcon size={12} />;
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

export function ClipsPage({ clips, searchQuery, onSearchChange, onRefresh }: ClipsPageProps): JSX.Element {
  const [previewClipId, setPreviewClipId] = useState<string | null>(null);
  const [localAssetUrlById, setLocalAssetUrlById] = useState<Record<string, string>>({});
  const [previewDurationSec, setPreviewDurationSec] = useState(0);
  const [trimStartSec, setTrimStartSec] = useState(0);
  const [trimEndSec, setTrimEndSec] = useState(0);
  const [playheadSec, setPlayheadSec] = useState(0);
  const [isExportingClip, setIsExportingClip] = useState(false);
  const [editorMessage, setEditorMessage] = useState<string | null>(null);
  const [wasmAdd, setWasmAdd] = useState<(a: number, b: number) => number>(() => WASM_ADD_FALLBACK);
  const loadingAssetIdsRef = useRef<Set<string>>(new Set());
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  const query = searchQuery.trim().toLowerCase();
  const filtered = query
    ? clips.filter((clip) => {
        const haystack = `${clip.gameTitle} ${clip.machineLabel ?? ""} ${clip.codec ?? ""} ${clipTypeLabel(clip.clipType)}`.toLowerCase();
        return haystack.includes(query);
      })
    : clips;

  const needsLocalAsset = (clip: ClipRecord): boolean =>
    Boolean(clip.filePath) && (!clip.fileUrl || clip.fileUrl.startsWith("file:"));

  const resolveClipSource = useCallback((clip: ClipRecord): string | null => {
    if (localAssetUrlById[clip.id]) {
      return localAssetUrlById[clip.id]!;
    }
    if (clip.fileUrl && !clip.fileUrl.startsWith("file:")) {
      return clip.fileUrl;
    }
    return null;
  }, [localAssetUrlById]);

  const previewClip = useMemo(
    () => filtered.find((clip) => clip.id === previewClipId) ?? clips.find((clip) => clip.id === previewClipId) ?? null,
    [clips, filtered, previewClipId],
  );
  const previewSource = previewClip ? resolveClipSource(previewClip) : null;
  const isPreviewVideo = previewClip ? previewClip.clipType !== "screenshot" : false;

  useEffect(() => {
    void getWasmAdd().then((addFn) => setWasmAdd(() => addFn));
  }, []);

  useEffect(() => {
    return () => {
      for (const url of objectUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      objectUrlsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const candidates = previewClip
      ? [...filtered, previewClip]
      : filtered;

    for (const clip of candidates) {
      if (!needsLocalAsset(clip) || !clip.filePath) {
        continue;
      }
      if (localAssetUrlById[clip.id] || loadingAssetIdsRef.current.has(clip.id)) {
        continue;
      }

      loadingAssetIdsRef.current.add(clip.id);
      void window.openNow.readCaptureAsset(clip.filePath)
        .then((asset) => {
          const blob = new Blob([new Uint8Array(asset.bytes)], { type: asset.mimeType });
          const url = URL.createObjectURL(blob);
          objectUrlsRef.current.add(url);
          setLocalAssetUrlById((prev) => ({ ...prev, [clip.id]: url }));
        })
        .catch((error) => {
          console.warn("Failed to load media asset:", error);
        })
        .finally(() => {
          loadingAssetIdsRef.current.delete(clip.id);
        });
    }
  }, [filtered, localAssetUrlById, previewClip]);

  useEffect(() => {
    setEditorMessage(null);
    setPreviewDurationSec(0);
    setTrimStartSec(0);
    setTrimEndSec(0);
    setPlayheadSec(0);
  }, [previewClipId]);

  const handlePreviewLoadedMetadata = useCallback(() => {
    const element = previewVideoRef.current;
    if (!element || !Number.isFinite(element.duration) || element.duration <= 0) {
      return;
    }
    const duration = element.duration;
    setPreviewDurationSec(duration);
    setTrimStartSec(0);
    setTrimEndSec(duration);
    setPlayheadSec(Math.min(element.currentTime, duration));
  }, []);

  const handlePreviewTimeUpdate = useCallback(() => {
    const element = previewVideoRef.current;
    if (!element) return;
    setPlayheadSec(element.currentTime);
  }, []);

  const handlePlayheadChange = useCallback((nextSec: number) => {
    const element = previewVideoRef.current;
    if (!element) return;
    const safe = Math.max(0, Math.min(nextSec, previewDurationSec || nextSec));
    element.currentTime = safe;
    setPlayheadSec(safe);
  }, [previewDurationSec]);

  const handleTrimStartChange = useCallback((nextStart: number) => {
    const maxStart = Math.max(0, trimEndSec - 0.2);
    const safe = Math.max(0, Math.min(nextStart, maxStart));
    setTrimStartSec(safe);
    if (playheadSec < safe) {
      handlePlayheadChange(safe);
    }
  }, [handlePlayheadChange, playheadSec, trimEndSec]);

  const handleTrimEndChange = useCallback((nextEnd: number) => {
    const minEnd = trimStartSec + 0.2;
    const safe = Math.max(minEnd, Math.min(nextEnd, previewDurationSec || nextEnd));
    setTrimEndSec(safe);
    if (playheadSec > safe) {
      handlePlayheadChange(safe);
    }
  }, [handlePlayheadChange, playheadSec, previewDurationSec, trimStartSec]);

  const exportEditedClip = useCallback(async () => {
    if (!previewClip || !previewSource || !isPreviewVideo) {
      return;
    }

    const startSec = Math.max(0, Math.min(trimStartSec, Math.max(0, trimEndSec - 0.2)));
    const endSec = Math.max(startSec + 0.2, trimEndSec);
    const captureMimeType = getPreferredEditorMimeType();
    if (typeof MediaRecorder === "undefined") {
      setEditorMessage("MediaRecorder is unavailable on this device.");
      return;
    }

    setIsExportingClip(true);
    setEditorMessage("Exporting clip...");
    try {
      const sourceVideo = document.createElement("video");
      sourceVideo.src = previewSource;
      sourceVideo.muted = true;
      sourceVideo.playsInline = true;
      sourceVideo.preload = "auto";

      await new Promise<void>((resolve, reject) => {
        sourceVideo.onloadedmetadata = () => resolve();
        sourceVideo.onerror = () => reject(new Error("Failed to load source media for editing."));
      });

      await new Promise<void>((resolve) => {
        const onSeeked = () => resolve();
        sourceVideo.addEventListener("seeked", onSeeked, { once: true });
        sourceVideo.currentTime = startSec;
      });

      const captureFn = (sourceVideo as HTMLVideoElement & { captureStream?: (frameRate?: number) => MediaStream }).captureStream;
      if (typeof captureFn !== "function") {
        throw new Error("Video captureStream is not supported in this runtime.");
      }
      const stream = captureFn.call(sourceVideo, 30);
      const recorder = captureMimeType
        ? new MediaRecorder(stream, { mimeType: captureMimeType, videoBitsPerSecond: 4_000_000 })
        : new MediaRecorder(stream, { videoBitsPerSecond: 4_000_000 });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      const startMs = Math.round(startSec * 1000);
      const clipLengthMs = Math.max(200, Math.round((endSec - startSec) * 1000));
      const targetEndMs = wasmAdd(startMs, clipLengthMs);

      await new Promise<void>((resolve, reject) => {
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          recorder.onstop = null;
          recorder.onerror = null;
          sourceVideo.pause();
          stream.getTracks().forEach((track) => track.stop());
          resolve();
        };

        const stopWhenReady = () => {
          if (recorder.state !== "inactive") {
            recorder.stop();
          } else {
            finish();
          }
        };

        const checker = window.setInterval(() => {
          const currentMs = Math.round(sourceVideo.currentTime * 1000);
          if (currentMs >= targetEndMs) {
            window.clearInterval(checker);
            stopWhenReady();
          }
        }, 40);

        recorder.onstop = () => {
          window.clearInterval(checker);
          finish();
        };
        recorder.onerror = () => {
          window.clearInterval(checker);
          reject(new Error("Failed while exporting the edited clip."));
        };

        recorder.start(400);
        sourceVideo.play().catch((error) => {
          window.clearInterval(checker);
          reject(error);
        });
      });

      if (chunks.length === 0) {
        throw new Error("No media frames were exported.");
      }

      const blob = new Blob(chunks, { type: chunks[0]?.type || captureMimeType || "video/webm" });
      const timestampMs = Date.now();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const asset = await window.openNow.saveCaptureAsset({
        clipType: "manual-recording",
        gameTitle: previewClip.gameTitle,
        timestampMs,
        extension: "webm",
        bytes,
      });
      const clipInput: ClipRecordInput = {
        clipType: "manual-recording",
        status: "saved",
        timestampMs,
        gameTitle: previewClip.gameTitle,
        gameBannerUrl: previewClip.gameBannerUrl,
        machineLabel: previewClip.machineLabel,
        codec: previewClip.codec,
        filePath: asset.filePath,
        fileUrl: asset.fileUrl,
        durationSeconds: Math.max(1, Math.round(endSec - startSec)),
        source: "server",
      };
      await window.openNow.saveClip(clipInput);
      onRefresh();
      setEditorMessage("Edited clip saved to your Media library.");
    } catch (error) {
      console.warn("Clip export failed:", error);
      setEditorMessage("Clip export failed.");
    } finally {
      setIsExportingClip(false);
    }
  }, [isPreviewVideo, onRefresh, previewClip, previewSource, trimEndSec, trimStartSec, wasmAdd]);

  return (
    <div className="clips-page">
      <header className="clips-toolbar">
        <div className="clips-title">
          <Clapperboard className="clips-title-icon" size={22} />
          <h1>Media</h1>
        </div>

        <div className="clips-search">
          <Search className="clips-search-icon" size={16} />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search media..."
            className="clips-search-input"
          />
        </div>

        <button type="button" className="clips-refresh-btn" onClick={onRefresh} title="Refresh media">
          <RefreshCw size={14} />
          Refresh
        </button>
      </header>

      <div className="clips-grid-area">
        {filtered.length === 0 ? (
          <div className="clips-empty-state">
            <Clapperboard className="clips-empty-icon" size={44} />
            <h3>No media yet</h3>
            <p>
              {query
                ? "No media matches your search."
                : "Use your capture shortcuts during a session to save instant replays, recordings, and screenshots."}
            </p>
          </div>
        ) : (
          <div className="clips-grid">
            {filtered.map((clip) => {
              const source = resolveClipSource(clip);
              const canPreview = Boolean(source);
              return (
                <article key={clip.id} className="clip-card">
                  <button
                    type="button"
                    className={`clip-card-banner clip-card-banner-btn${canPreview ? "" : " is-disabled"}`}
                    onClick={() => {
                      if (canPreview) {
                        setPreviewClipId(clip.id);
                      }
                    }}
                    disabled={!canPreview}
                  >
                    {source ? (
                      clip.clipType === "screenshot" ? (
                        <img src={source} alt={clip.gameTitle} className="clip-card-image" loading="lazy" />
                      ) : (
                        <video src={source} className="clip-card-image" muted playsInline preload="metadata" />
                      )
                    ) : clip.gameBannerUrl ? (
                      <img src={clip.gameBannerUrl} alt={clip.gameTitle} className="clip-card-image" loading="lazy" />
                    ) : (
                      <div className="clip-card-fallback">
                        <Clapperboard size={20} />
                      </div>
                    )}
                    <span className="clip-card-type-pill">
                      {clipTypeIcon(clip.clipType)}
                      {clipTypeLabel(clip.clipType)}
                    </span>
                  </button>

                  <div className="clip-card-body">
                    <h3 className="clip-card-title">{clip.gameTitle}</h3>
                    <div className="clip-card-meta">
                      {clip.codec && <span className="clip-card-chip">{clip.codec}</span>}
                    </div>

                    <div className="clip-card-row">
                      <Cpu size={12} />
                      <span>{clip.machineLabel || "Unknown machine"}</span>
                    </div>
                    <div className="clip-card-row">
                      <Clock3 size={12} />
                      <span>{formatTimestamp(clip.timestampMs)}</span>
                    </div>

                    {canPreview && (
                      <button type="button" className="clip-card-link" onClick={() => setPreviewClipId(clip.id)}>
                        Open in editor
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {previewClip && previewSource && (
        <div className="clips-preview-backdrop" onClick={() => setPreviewClipId(null)}>
          <div
            className="clips-preview-modal clips-preview-modal--editor"
            role="dialog"
            aria-modal="true"
            aria-label="Media preview"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="clips-preview-head">
              <strong>{previewClip.gameTitle}</strong>
              <button type="button" className="clips-preview-close" onClick={() => setPreviewClipId(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="clips-preview-content">
              {isPreviewVideo ? (
                <video
                  ref={previewVideoRef}
                  src={previewSource}
                  controls
                  autoPlay
                  playsInline
                  className="clips-preview-media"
                  onLoadedMetadata={handlePreviewLoadedMetadata}
                  onTimeUpdate={handlePreviewTimeUpdate}
                />
              ) : (
                <img src={previewSource} alt={previewClip.gameTitle} className="clips-preview-media" />
              )}
            </div>

            {isPreviewVideo && previewDurationSec > 0 && (
              <div className="media-editor">
                <div className="media-editor-header">
                  <span className="media-editor-title">
                    <Scissors size={14} />
                    Clip Editor (WASM scrub math)
                  </span>
                  <span className="media-editor-time">
                    {formatTime(trimStartSec)} - {formatTime(trimEndSec)} ({Math.max(0, Math.round(trimEndSec - trimStartSec))}s)
                  </span>
                </div>

                <div className="media-editor-scrubber">
                  <input
                    type="range"
                    min={0}
                    max={previewDurationSec}
                    step={0.01}
                    value={playheadSec}
                    onChange={(event) => handlePlayheadChange(Number(event.target.value))}
                    className="media-editor-range media-editor-range--playhead"
                  />
                </div>

                <div className="media-editor-trim-row">
                  <label>
                    In
                    <input
                      type="range"
                      min={0}
                      max={previewDurationSec}
                      step={0.01}
                      value={trimStartSec}
                      onChange={(event) => handleTrimStartChange(Number(event.target.value))}
                      className="media-editor-range"
                    />
                  </label>
                  <label>
                    Out
                    <input
                      type="range"
                      min={0}
                      max={previewDurationSec}
                      step={0.01}
                      value={trimEndSec}
                      onChange={(event) => handleTrimEndChange(Number(event.target.value))}
                      className="media-editor-range"
                    />
                  </label>
                </div>

                <div className="media-editor-actions">
                  <button
                    type="button"
                    className="clip-card-link media-editor-export-btn"
                    onClick={() => {
                      void exportEditedClip();
                    }}
                    disabled={isExportingClip}
                  >
                    {isExportingClip ? "Exporting..." : "Export clipped media"}
                  </button>
                  {editorMessage && <span className="media-editor-message">{editorMessage}</span>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
