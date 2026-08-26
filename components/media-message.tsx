"use client";

/* eslint-disable @next/next/no-img-element, jsx-a11y/media-has-caption */

import { useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { cloudinaryAudioFallbackUrl, type CloudinaryResourceType, type MediaMessageKind } from "@/lib/media";

export type ChatMessage = {
  id: number;
  senderId: string;
  recipientId: string;
  text: string;
  from: "me" | "them";
  createdAt: number;
  kind?: MediaMessageKind;
  mediaUrl?: string;
  mediaPublicId?: string;
  mediaResourceType?: CloudinaryResourceType;
  mediaFormat?: string;
  mediaBytes?: number;
  mimeType?: string;
  fileName?: string;
  duration?: number;
  clientId?: string;
  editedAt?: number;
  deletedAt?: number;
  readAt?: number;
  replyTo?: {
    id: number;
    text: string;
    kind: MediaMessageKind;
    from: "me" | "them";
    senderName: string;
    deleted: boolean;
  };
  reactions?: Array<{
    emoji: string;
    userId: string;
    username: string;
    mine: boolean;
  }>;
  deliveryState?: "sending" | "failed";
  uploadProgress?: number;
  deliveryError?: string;
};

const waveformBars = [12, 20, 16, 27, 18, 31, 22, 14, 25, 34, 19, 28, 16, 23, 32, 20, 13, 26, 35, 22, 17, 29, 21, 14, 24, 18];

function formatAudioTime(value: number) {
  const seconds = Math.max(0, Math.floor(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function AudioMessage({ message }: { message: ChatMessage }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(message.duration ?? 0);
  const [failed, setFailed] = useState(false);
  const progress = duration > 0 ? Math.min(elapsed / duration, 1) : 0;
  const fallbackUrl = message.mediaUrl ? cloudinaryAudioFallbackUrl(message.mediaUrl) : "";

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  };

  const seek = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const audio = audioRef.current;
    const availableDuration = Number.isFinite(audio?.duration) ? audio?.duration ?? duration : duration;
    if (!audio || availableDuration <= 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    audio.currentTime = availableDuration * ratio;
    setElapsed(audio.currentTime);
  };

  if (failed) return <span className="media-unavailable">Voice message unavailable</span>;

  return <div className="message-audio">
    <button type="button" className="audio-play" aria-label={playing ? "Pause voice message" : "Play voice message"} onClick={togglePlayback}>{playing ? "Ⅱ" : "▶"}</button>
    <button type="button" className="audio-waveform" aria-label="Seek voice message" onClick={seek}>{waveformBars.map((height, index) => <i className={(index + 1) / waveformBars.length <= progress ? "played" : ""} style={{ height }} key={`${height}-${index}`} />)}</button>
    <span className="audio-duration">{formatAudioTime(elapsed > 0 ? elapsed : duration)}</span>
    <audio ref={audioRef} preload="metadata" aria-label="Voice message" onLoadedMetadata={(event) => { if (Number.isFinite(event.currentTarget.duration)) setDuration(event.currentTarget.duration); }} onTimeUpdate={(event) => setElapsed(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setElapsed(0); }} onError={() => setFailed(true)}>
      <source src={message.mediaUrl} type={message.mimeType} />
      {fallbackUrl && fallbackUrl !== message.mediaUrl && <source src={fallbackUrl} type="audio/mpeg" />}
    </audio>
  </div>;
}

function PhotoMessage({ message, onPreview }: { message: ChatMessage; onPreview?: (message: ChatMessage) => void }) {
  const originalSource = message.mediaUrl ?? "";
  const [useProxy, setUseProxy] = useState(false);
  const [failed, setFailed] = useState(false);
  const source = useProxy ? `/api/media/image?url=${encodeURIComponent(originalSource)}` : originalSource;

  if (failed || !source) {
    return <span className="media-unavailable">{message.deliveryState === "sending" ? "Preparing photo…" : "Photo unavailable"}</span>;
  }
  const image = <img className="message-image" src={source} alt={message.fileName || "Shared photo"} loading="eager" decoding="async" referrerPolicy="no-referrer" onError={() => { if (!useProxy && originalSource.startsWith("https://res.cloudinary.com/")) setUseProxy(true); else setFailed(true); }} />;
  return onPreview ? <button type="button" className="message-image-button" onClick={() => onPreview(message)} aria-label={`Open ${message.fileName || "shared photo"} fullscreen`}>{image}</button> : image;
}

export function MediaMessage({ message, onPreview }: { message: ChatMessage; onPreview?: (message: ChatMessage) => void }) {
  const source = message.mediaUrl;
  if (!source) return <span className="media-unavailable">Attachment unavailable</span>;
  if (message.kind === "image") return <PhotoMessage message={message} onPreview={onPreview} />;
  if (message.kind === "video") return <video className="message-video" src={source} controls playsInline preload="metadata" aria-label={message.fileName || "Shared video"} />;
  if (message.kind === "document") {
    const extension = message.fileName?.split(".").pop()?.slice(0, 4).toUpperCase() || "FILE";
    return <a className="message-document" href={source} download={message.fileName || "Famochat document"}><i>{extension}</i><span><strong>{message.fileName || "Shared document"}</strong><small>Tap to download</small></span><b>↓</b></a>;
  }
  if (message.kind === "audio") return <AudioMessage message={message} />;
  return <span className="media-unavailable">Unsupported attachment</span>;
}
