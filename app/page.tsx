"use client";

/* eslint-disable @next/next/no-img-element, jsx-a11y/media-has-caption, jsx-a11y/no-autofocus, jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-static-element-interactions, react-hooks/purity */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, MouseEvent as ReactMouseEvent } from "react";

type Screen = "welcome" | "signup" | "signin" | "app";
type CircleType = "Family" | "Relative" | "Close friend";
type LocationPermission = "checking" | "prompt" | "granted" | "denied" | "unavailable";
type MessageKind = "text" | "image" | "video" | "audio" | "document";

type Message = {
  id: number;
  text: string;
  from: "me" | "them";
  createdAt: number;
  kind?: MessageKind;
  mediaUrl?: string;
  mediaPublicId?: string;
  mimeType?: string;
  fileName?: string;
  duration?: number;
};

type OutgoingMessage = {
  text: string;
  kind: MessageKind;
  mediaUrl?: string;
  mediaPublicId?: string;
  mimeType?: string;
  fileName?: string;
  duration?: number;
};

type Person = {
  id: string;
  name: string;
  username: string;
  relation: string;
  category: CircleType;
  online: boolean;
  approved: boolean;
  locationShared: boolean;
  liveContextShared: boolean;
  parentalControl: boolean;
  contactRemovalLocked: boolean;
  activity: string;
  speed: string;
  location: string;
  eta: string;
  temperature: string;
  weather: string;
  battery: number | null;
  charging: boolean | null;
  tone: string;
};

type RelationshipRequest = {
  id: string;
  fromUsername: string;
  fromName: string;
  relation: string;
  category: CircleType;
  createdAt: number;
};

type Account = {
  name: string;
  username: string;
  email: string;
  phone: string;
  contacts: Person[];
  requests: RelationshipRequest[];
  messages: Record<string, Message[]>;
};

type AuthPayload = {
  mode: "signup" | "signin";
  name: string;
  username: string;
  email: string;
  phone: string;
  password: string;
};

type AddPersonPayload = {
  username: string;
  category: CircleType;
  relation: string;
};

type LiveContext = {
  latitude: number;
  longitude: number;
  locationLabel: string;
  temperature: number | null;
  weather: string;
  battery: number | null;
  charging: boolean | null;
};

type BatteryManagerLike = {
  level: number;
  charging: boolean;
};

const tones = ["tone-dark", "tone-mid", "tone-light", "tone-soft", "tone-silver"];

function weatherLabel(code: number | undefined) {
  if (code === 0) return "Clear";
  if (code === 1) return "Mostly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Foggy";
  if (code != null && code >= 51 && code <= 57) return "Drizzle";
  if (code != null && code >= 61 && code <= 67) return "Rain";
  if (code != null && code >= 71 && code <= 77) return "Snow";
  if (code != null && code >= 80 && code <= 82) return "Rain showers";
  if (code != null && code >= 85 && code <= 86) return "Snow showers";
  if (code != null && code >= 95) return "Thunderstorm";
  return "Unavailable";
}

async function collectLiveContext(position: GeolocationPosition): Promise<LiveContext> {
  const { latitude, longitude } = position.coords;
  const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
  weatherUrl.searchParams.set("latitude", String(latitude));
  weatherUrl.searchParams.set("longitude", String(longitude));
  weatherUrl.searchParams.set("current", "temperature_2m,weather_code");
  weatherUrl.searchParams.set("timezone", "auto");

  const placeUrl = new URL("https://api.bigdatacloud.net/data/reverse-geocode-client");
  placeUrl.searchParams.set("latitude", String(latitude));
  placeUrl.searchParams.set("longitude", String(longitude));
  placeUrl.searchParams.set("localityLanguage", "en");

  const batteryGetter = (navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> }).getBattery;
  const [weatherResult, placeResult, batteryResult] = await Promise.allSettled([
    fetch(weatherUrl, { cache: "no-store" }).then((response) => response.ok ? response.json() : null),
    fetch(placeUrl, { cache: "no-store" }).then((response) => response.ok ? response.json() : null),
    batteryGetter ? batteryGetter.call(navigator) : Promise.resolve(null),
  ]);

  const weatherData = weatherResult.status === "fulfilled" ? weatherResult.value as { current?: { temperature_2m?: number; weather_code?: number } } | null : null;
  const placeData = placeResult.status === "fulfilled" ? placeResult.value as { locality?: string; city?: string; principalSubdivision?: string; countryName?: string } | null : null;
  const batteryData = batteryResult.status === "fulfilled" ? batteryResult.value : null;
  const placeParts = [placeData?.locality || placeData?.city, placeData?.principalSubdivision, placeData?.countryName].filter((part, index, values) => part && values.indexOf(part) === index);

  return {
    latitude,
    longitude,
    locationLabel: placeParts.join(", ") || `${latitude.toFixed(4)}°, ${longitude.toFixed(4)}°`,
    temperature: typeof weatherData?.current?.temperature_2m === "number" ? weatherData.current.temperature_2m : null,
    weather: weatherLabel(weatherData?.current?.weather_code),
    battery: batteryData ? Math.round(batteryData.level * 100) : null,
    charging: batteryData?.charging ?? null,
  };
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "K";
}

function toneFor(value: string) {
  const total = [...value].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return tones[total % tones.length];
}

function formatMessageTime(value: number, mine: boolean) {
  const date = new Date(value);
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  const label = sameDay
    ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date)
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
  return `${label}${mine ? " · Sent" : ""}`;
}

function formatAudioTime(value: number) {
  const seconds = Math.max(0, Math.floor(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

type AccountResponse = { account?: Account; error?: string };

async function accountRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const data = response.status === 204 ? {} : await response.json() as AccountResponse;
  if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data.account ?? null;
}

async function uploadToCloudinary(file: Blob) {
  const signatureResponse = await fetch("/api/media/signature", { method: "POST" });
  const signatureData = await signatureResponse.json() as {
    cloudName?: string;
    apiKey?: string;
    timestamp?: number;
    folder?: string;
    signature?: string;
    error?: string;
  };
  if (!signatureResponse.ok || !signatureData.cloudName || !signatureData.apiKey || !signatureData.timestamp || !signatureData.folder || !signatureData.signature) {
    throw new Error(signatureData.error || "Media uploads are not configured.");
  }

  const form = new FormData();
  form.set("file", file);
  form.set("api_key", signatureData.apiKey);
  form.set("timestamp", String(signatureData.timestamp));
  form.set("folder", signatureData.folder);
  form.set("signature", signatureData.signature);
  const uploadResponse = await fetch(`https://api.cloudinary.com/v1_1/${signatureData.cloudName}/auto/upload`, { method: "POST", body: form });
  const uploaded = await uploadResponse.json() as { secure_url?: string; public_id?: string; error?: { message?: string } };
  if (!uploadResponse.ok || !uploaded.secure_url || !uploaded.public_id) {
    throw new Error(uploaded.error?.message || "The attachment could not be uploaded.");
  }
  return { mediaUrl: uploaded.secure_url, mediaPublicId: uploaded.public_id };
}

const waveformBars = [12, 20, 16, 27, 18, 31, 22, 14, 25, 34, 19, 28, 16, 23, 32, 20, 13, 26, 35, 22, 17, 29, 21, 14, 24, 18];

function AudioMessage({ message }: { message: Message }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(message.duration ?? 0);
  const progress = duration > 0 ? Math.min(elapsed / duration, 1) : 0;

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

  return <div className="message-audio">
    <button type="button" className="audio-play" aria-label={playing ? "Pause voice message" : "Play voice message"} onClick={togglePlayback}>{playing ? "Ⅱ" : "▶"}</button>
    <button type="button" className="audio-waveform" aria-label="Seek voice message" onClick={seek}>{waveformBars.map((height, index) => <i className={(index + 1) / waveformBars.length <= progress ? "played" : ""} style={{ height }} key={`${height}-${index}`} />)}</button>
    <span className="audio-duration">{formatAudioTime(elapsed > 0 ? elapsed : duration)}</span>
    <audio ref={audioRef} src={message.mediaUrl} preload="metadata" aria-label="Voice message" onLoadedMetadata={(event) => { if (Number.isFinite(event.currentTarget.duration)) setDuration(event.currentTarget.duration); }} onTimeUpdate={(event) => setElapsed(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setElapsed(0); }} />
  </div>;
}

function MediaMessage({ message, onPreview }: { message: Message; onPreview?: (message: Message) => void }) {
  const source = message.mediaUrl;
  if (!source) return <span className="media-unavailable">Attachment unavailable</span>;
  if (message.kind === "image") {
    const image = <img className="message-image" src={source} alt={message.fileName || "Shared photo"} />;
    return onPreview ? <button type="button" className="message-image-button" onClick={() => onPreview(message)} aria-label={`Open ${message.fileName || "shared photo"} fullscreen`}>{image}</button> : image;
  }
  if (message.kind === "video") return <video className="message-video" src={source} controls playsInline preload="metadata" aria-label={message.fileName || "Shared video"} />;
  if (message.kind === "document") {
    const extension = message.fileName?.split(".").pop()?.slice(0, 4).toUpperCase() || "FILE";
    return <a className="message-document" href={source} download={message.fileName || "Famochat document"}><i>{extension}</i><span><strong>{message.fileName || "Shared document"}</strong><small>Tap to download</small></span><b>↓</b></a>;
  }
  return <AudioMessage message={message} />;
}

function Brand() {
  return <div className="brand" aria-label="Famochat"><strong className="brand-famo">famo</strong><span className="brand-chat">chat</span></div>;
}

function WindowDots({ onMinimize }: { onMinimize?: () => void }) {
  return <div className="window-dots" aria-label="Window controls"><button aria-label="Close" /><button aria-label="Minimize people panel" onClick={onMinimize} /><button aria-label="Expand" /></div>;
}

function Welcome({ onScreen }: { onScreen: (screen: Screen) => void }) {
  return (
    <main className="auth-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <section className="auth-window welcome-window">
        <header className="auth-window-bar"><WindowDots /><Brand /><span className="tiny-status"><i /> Private by design</span></header>
        <div className="welcome-grid">
          <div className="welcome-copy">
            <span className="kicker">For your inner circle</span>
            <h1>Keep the people<br />you love <em>close.</em></h1>
            <p>A quieter messenger for family and close friends—chat, share live context, and know they’re okay without checking in.</p>
            <div className="welcome-actions"><button className="primary-button" onClick={() => onScreen("signup")}>Create your circle <span>→</span></button><button className="secondary-button" onClick={() => onScreen("signin")}>Sign in</button></div>
            <div className="trust-row"><span>◈ Encrypted in transit</span><span>◎ You control location</span></div>
          </div>
          <div className="welcome-visual" aria-label="Preview of a live family conversation">
            <div className="phone-preview">
              <div className="phone-island" />
              <div className="preview-head"><span className="preview-avatar">K<i /></span><div><strong>Your person</strong><small>Live context on</small></div><span>•••</span></div>
              <div className="preview-live"><div className="mini-map"><i className="map-route" /><span className="mini-pin" /></div><span className="live-label"><i /> Live</span><strong>Lakeside Road</strong><small>8 min away · 18° clear</small></div>
              <div className="preview-bubble their">Almost home!</div><div className="preview-bubble mine">See you soon ♡</div><div className="preview-compose">Write a message <b>↑</b></div>
            </div>
            <div className="float-card float-one"><span>⌖</span><div><small>LOCATION</small><strong>You choose who sees it</strong></div></div>
            <div className="float-card float-two"><span className="online-pulse" /><div><small>YOUR CIRCLE</small><strong>Private and approved</strong></div></div>
          </div>
        </div>
      </section>
    </main>
  );
}

function LocationAccessModal({ status, busy, onAllow, onClose }: {
  status: LocationPermission;
  busy: boolean;
  onAllow: () => void;
  onClose: () => void;
}) {
  const blocked = status === "denied";
  const unavailable = status === "unavailable";
  const title = blocked ? "Location is blocked" : unavailable ? "Location isn’t available" : "Allow location sharing?";
  const description = blocked
    ? "Famochat can’t share your location until location access is enabled for this site in your browser settings."
    : unavailable
      ? "Famochat couldn’t read your current location. Check that location services are on, then try again."
      : "Famochat needs your location only when you choose to share it with someone in your approved circle.";

  return (
    <div className="modal-backdrop location-permission-backdrop">
      <section className="glass-modal safety-modal location-access-modal" role="dialog" aria-modal="true" aria-labelledby="location-access-title">
        <div className="safety-icon location-access-icon">⌖<i /></div>
        <span className="kicker">Location privacy</span>
        <h2 id="location-access-title">{title}</h2>
        <p>{description}</p>
        <div className="setting-preview location-preview">
          <div><span>Precise location</span><small>Used only while location sharing is on</small></div>
          <span className={`permission-status ${status === "granted" ? "on" : ""}`}>{status === "granted" ? "Allowed" : "Required"}</span>
        </div>
        <button className="primary-button" onClick={onAllow} disabled={busy || status === "checking"}>
          {busy || status === "checking" ? "Waiting for permission…" : blocked ? "Check location access" : unavailable ? "Try again" : "Allow location"}<span>⌖</span>
        </button>
        <button className="text-button" onClick={onClose}>Continue without location</button>
      </section>
    </div>
  );
}

function AuthForm({ mode, onBack, onAuthenticate, onSwitch }: {
  mode: "signup" | "signin";
  onBack: () => void;
  onAuthenticate: (payload: AuthPayload) => Promise<string | null>;
  onSwitch: () => void;
}) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanUsername = username.trim().replace(/^@/, "").toLowerCase();
    if (!/^[A-Za-z0-9]{3,}$/.test(cleanUsername)) { setError("Use at least 3 letters or numbers—no spaces or symbols."); return; }
    if (mode === "signup" && name.trim().length < 2) { setError("Enter the name your contacts will recognize."); return; }
    if (mode === "signup" && !/^\S+@\S+\.\S+$/.test(email.trim())) { setError("Enter a valid email address."); return; }
    if (password.length < 8) { setError("Your password needs at least 8 characters."); return; }
    if (mode === "signup" && password !== confirm) { setError("Those passwords don’t match yet."); return; }
    setBusy(true);
    const result = await onAuthenticate({ mode, name: name.trim(), username: cleanUsername, email: email.trim().toLowerCase(), phone: phone.trim(), password });
    setBusy(false);
    if (result) setError(result);
  };

  return (
    <main className="auth-shell form-page">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <section className="auth-window form-window">
        <header className="auth-window-bar"><WindowDots /><Brand /><button className="quiet-link" onClick={onBack}>Back</button></header>
        <div className="form-layout">
          <div className="form-intro"><span className="kicker">{mode === "signup" ? "Start your circle" : "Welcome back"}</span><h1>{mode === "signup" ? <>A safe place for<br /><em>your people.</em></> : <>Good to<br /><em>see you.</em></>}</h1><p>{mode === "signup" ? "Your details help the people you invite know it’s really you." : "Your circle is right where you left it."}</p><div className="privacy-stamp"><span>◈</span><div><strong>Private by default</strong><small>Your profile is only visible to people you approve.</small></div></div></div>
          <form className="auth-form" onSubmit={submit} noValidate>
            <div className="form-title"><h2>{mode === "signup" ? "Create account" : "Sign in"}</h2><p>{mode === "signup" ? "All fields except phone are required." : "Use your Famochat username and password."}</p></div>
            {mode === "signup" && <><label className="field"><span>Your name</span><input required value={name} onChange={(event) => { setName(event.target.value); setError(""); }} autoComplete="name" placeholder="Your full name" /></label><label className="field"><span>Username</span><div className="input-prefix"><b>@</b><input required value={username} onChange={(event) => { setUsername(event.target.value); setError(""); }} autoComplete="username" placeholder="yourname" /></div><small>At least 3 letters or numbers. No special characters.</small></label><div className="field-row"><label className="field"><span>Email</span><input required type="email" value={email} onChange={(event) => { setEmail(event.target.value); setError(""); }} autoComplete="email" placeholder="you@example.com" /></label><label className="field"><span>Phone <i>optional</i></span><input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" placeholder="+977 98…" /></label></div></>}
            {mode === "signin" && <label className="field"><span>Username</span><div className="input-prefix"><b>@</b><input required autoComplete="username" value={username} onChange={(event) => { setUsername(event.target.value); setError(""); }} placeholder="username" /></div></label>}
            <div className={mode === "signup" ? "field-row" : ""}><label className="field"><span>Password</span><input required minLength={8} type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} placeholder="At least 8 characters" /></label>{mode === "signup" && <label className="field"><span>Confirm password</span><input required type="password" autoComplete="new-password" value={confirm} onChange={(event) => { setConfirm(event.target.value); setError(""); }} placeholder="Repeat password" /></label>}</div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <p className="auth-note">Your account, requests, and conversations stay synced across devices.</p>
            <button className="primary-button form-submit" type="submit" disabled={busy}>{busy ? "Securing account…" : mode === "signup" ? "Create my circle" : "Sign in"}<span>→</span></button>
            <p className="form-switch">{mode === "signup" ? "Already have an account?" : "New to Famochat?"} <button type="button" onClick={onSwitch}>{mode === "signup" ? "Sign in" : "Create account"}</button></p>
          </form>
        </div>
      </section>
    </main>
  );
}

function Messenger({ account, onSignOut, onUpdateContact, onSendRequest, onApproveRequest, onDeclineRequest, onRemoveContact, onSendMessage, onRequestLocation }: {
  account: Account;
  onSignOut: () => Promise<void>;
  onUpdateContact: (username: string, patch: Pick<Person, "locationShared" | "parentalControl">) => Promise<string | null>;
  onSendRequest: (payload: AddPersonPayload) => Promise<string | null>;
  onApproveRequest: (request: RelationshipRequest) => Promise<string | null>;
  onDeclineRequest: (request: RelationshipRequest) => Promise<string | null>;
  onRemoveContact: (username: string) => Promise<string | null>;
  onSendMessage: (username: string, message: OutgoingMessage) => Promise<string | null>;
  onRequestLocation: () => Promise<boolean>;
}) {
  const people = account.contacts;
  const messages = account.messages;
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileList, setMobileList] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Person | null>(null);
  const [parentPrompt, setParentPrompt] = useState<Person | null>(null);
  const [lockRequest, setLockRequest] = useState<Person | null>(null);
  const [toast, setToast] = useState("");
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [previewMessage, setPreviewMessage] = useState<Message | null>(null);
  const [previewZoomed, setPreviewZoomed] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStartedRef = useRef(0);
  const recordingTargetRef = useRef("");
  const messagesRef = useRef<HTMLDivElement>(null);
  const emojis = ["❤️", "😂", "🥰", "😊", "👍", "🙏", "😍", "🎉", "😢", "🤗", "🔥", "✨", "💯", "👋", "😘", "🫶"];

  const selected = people.find((person) => person.id === selectedId) ?? people.find((person) => person.approved);
  const activeMessages = selected ? messages[selected.id] ?? [] : [];
  const filteredPeople = people.filter((person) => `${person.name} ${person.relation} ${person.username}`.toLowerCase().includes(search.toLowerCase()));
  const userInitials = initials(account.name);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setRecordingSeconds(Math.floor((Date.now() - recordingStartedRef.current) / 1000)), 500);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const messageList = messagesRef.current;
      if (messageList) messageList.scrollTo({ top: messageList.scrollHeight, behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selected?.id, activeMessages.length]);

  useEffect(() => () => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    if (!previewMessage) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setPreviewMessage(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [previewMessage]);

  const updatePerson = (id: string, patch: Partial<Person>) => {
    const person = people.find((item) => item.id === id);
    if (!person) return;
    const next = { ...person, ...patch };
    void onUpdateContact(person.username, {
      locationShared: next.locationShared,
      parentalControl: next.parentalControl,
    }).then((error) => { if (error) setToast(error); });
  };

  const choosePerson = (person: Person) => {
    if (!person.approved) { setToast(`Waiting for @${person.username} to approve your relationship.`); return; }
    setSelectedId(person.id);
    setMobileList(false);
  };

  const toggleLocation = async (person: Person) => {
    if (!person.approved) return;
    if (person.locationShared && person.parentalControl) { setLockRequest(person); return; }
    if (!person.locationShared) {
      const allowed = await onRequestLocation();
      if (!allowed) { setToast("Allow location access before turning on sharing."); return; }
    }
    if (!person.locationShared && person.category === "Family") { setParentPrompt(person); return; }
    updatePerson(person.id, { locationShared: !person.locationShared });
    setToast(!person.locationShared ? `Location shared with ${person.name}.` : `Location sharing paused for ${person.name}.`);
  };

  const sendMessage = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !selected) return;
    void onSendMessage(selected.username, { kind: "text", text }).then((error) => { if (error) setToast(error); });
    setDraft("");
    setEmojiOpen(false);
  };

  const openPhotoPreview = (message: Message) => {
    setPreviewZoomed(false);
    setPreviewMessage(message);
  };

  const sendFile = async (event: ChangeEvent<HTMLInputElement>, kind: "image" | "video" | "document") => {
    const file = event.target.files?.[0];
    event.target.value = "";
    setAttachmentMenuOpen(false);
    if (!file || !selected) return;
    const limit = kind === "image" ? 25 * 1024 * 1024 : kind === "video" ? 100 * 1024 * 1024 : 50 * 1024 * 1024;
    if (file.size > limit) {
      setToast(kind === "image" ? "Choose a photo smaller than 25 MB." : kind === "video" ? "Choose a video smaller than 100 MB." : "Choose a document smaller than 50 MB.");
      return;
    }
    try {
      setToast("Uploading attachment…");
      const uploaded = await uploadToCloudinary(file);
      const error = await onSendMessage(selected.username, { kind, text: "", ...uploaded, mimeType: file.type, fileName: file.name });
      if (error) throw new Error(error);
      setToast(kind === "image" ? "Photo sent." : kind === "video" ? "Video sent." : "Document sent.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "This attachment could not be uploaded.");
    }
  };

  const stopVoiceRecording = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    setRecording(false);
  };

  const startVoiceRecording = async () => {
    if (recording) { stopVoiceRecording(); return; }
    if (!selected) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setToast("Voice recording isn’t supported by this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = preferredType ? new MediaRecorder(stream, { mimeType: preferredType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recordingStreamRef.current = stream;
      recordingChunksRef.current = [];
      recordingTargetRef.current = selected.username;
      recordingStartedRef.current = Date.now();
      setRecordingSeconds(0);
      recorder.ondataavailable = (event) => { if (event.data.size > 0) recordingChunksRef.current.push(event.data); };
      recorder.onstop = async () => {
        const duration = Math.max(1, Math.round((Date.now() - recordingStartedRef.current) / 1000));
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || preferredType || "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
        recorderRef.current = null;
        setRecording(false);
        if (!blob.size) { setToast("No voice audio was captured."); return; }
        try {
          setToast("Uploading voice message…");
          const uploaded = await uploadToCloudinary(blob);
          const error = await onSendMessage(recordingTargetRef.current, { kind: "audio", text: "", ...uploaded, mimeType: blob.type, fileName: "Voice message", duration });
          if (error) throw new Error(error);
          setToast("Voice message sent.");
        } catch (error) {
          setToast(error instanceof Error ? error.message : "The voice message could not be uploaded.");
        }
      };
      recorder.onerror = () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        setToast("Voice recording stopped unexpectedly.");
      };
      recorder.start(250);
      setRecording(true);
      setAttachmentMenuOpen(false);
      setEmojiOpen(false);
    } catch {
      setToast("Microphone access is needed to send a voice message.");
    }
  };

  const removeContact = async (person: Person) => {
    const remaining = people.filter((item) => item.id !== person.id && item.approved);
    const error = await onRemoveContact(person.username);
    if (error) { setToast(error); return; }
    if (selectedId === person.id) setSelectedId(remaining[0]?.id ?? "");
    setRemoveTarget(null);
    setDetailsOpen(false);
    setMobileList(true);
    setToast(`${person.name} was removed from your circle. Location sharing has ended.`);
  };

  return (
    <main className="site-shell messenger-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <section className={`messenger ${collapsed ? "pane-collapsed" : ""}`} aria-label="Famochat messenger">
        <header className="window-bar"><WindowDots onMinimize={() => setCollapsed((value) => !value)} /><Brand /><div className="window-actions"><button className="notice-button" aria-label={`${account.requests.length} relationship requests`} onClick={() => { setNoticesOpen(true); setProfileOpen(false); }}>◇{account.requests.length > 0 && <i />}</button><button className="profile-button" aria-label="Open account menu" onClick={() => setProfileOpen((value) => !value)}>{userInitials}</button>{profileOpen && <div className="profile-menu"><div><strong>{account.name}</strong><small>@{account.username}</small></div><button onClick={() => setToast("Settings are ready for your preferences.")}>Preferences <span>›</span></button><button onClick={() => { void onSignOut(); }}>Sign out <span>↗</span></button></div>}</div></header>
        <div className={`workspace ${mobileList ? "mobile-list" : ""}`}>
          <aside className="people-pane">
            <div className="pane-heading"><div className="pane-title"><span className="eyebrow">Your circle</span><h1>People</h1></div><div className="pane-tools"><button className="mobile-notice" aria-label={`${account.requests.length} requests`} onClick={() => setNoticesOpen(true)}>◇{account.requests.length > 0 && <i />}</button><button className="add-button" onClick={() => setAddOpen(true)} aria-label="Add a person">+</button></div></div>
            <label className="search-field"><span aria-hidden="true">⌕</span><input aria-label="Search people" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your circle" /></label>
            <div className="people-list">
              {filteredPeople.map((person) => <div className={`person-row ${selected?.id === person.id ? "active" : ""} ${!person.approved ? "pending" : ""}`} key={person.id}><button className="person-main" onClick={() => choosePerson(person)} aria-label={`Open chat with ${person.name}`}><span className={`avatar ${person.tone}`}>{initials(person.name)}<i className={person.online ? "online" : "offline"} /></span><span className="person-copy"><strong>{person.name}</strong><small>{person.approved ? person.relation : "Approval pending"}</small></span></button><button className={`share-toggle ${person.locationShared ? "on" : ""} ${person.parentalControl ? "locked" : ""}`} onClick={() => toggleLocation(person)} aria-label={`${person.locationShared ? "Stop" : "Start"} sharing location with ${person.name}`} aria-pressed={person.locationShared} disabled={!person.approved}><span>{person.parentalControl ? "•" : ""}</span></button></div>)}
              {filteredPeople.length === 0 && <div className="empty-list">{people.length === 0 ? "No contacts yet. Add another Famochat account to begin." : "No one in your circle matches that search."}</div>}
            </div>
            <div className="pane-footer"><button className="you-card" onClick={() => setProfileOpen(true)}><span className="avatar you-avatar">{userInitials}<i className="online" /></span><span><strong>{account.name}</strong><small>@{account.username}</small></span><b>•••</b></button><div className="secure-note"><span>◈</span><p><strong>Your circle stays yours.</strong><br />Encrypted in transit</p></div></div>
          </aside>
          <section className="chat-pane">
            {selected ? <><div className="chat-topbar"><button className="mobile-back" onClick={() => setMobileList(true)} aria-label="Back to people">‹</button><button className="desktop-collapse" onClick={() => setCollapsed((value) => !value)} aria-label="Toggle people panel">◫</button><span className={`avatar compact ${selected.tone}`}>{initials(selected.name)}<i className={selected.online ? "online" : "offline"} /></span><div className="chat-title"><strong>{selected.name}</strong><small>{selected.online ? `${selected.activity} · now` : "Offline"}</small></div><button className="circle-action" aria-label={`Call ${selected.name}`} onClick={() => setToast(`Starting a private call with ${selected.name}…`)}>⌁</button><button className="circle-action" aria-label="Conversation details" onClick={() => setDetailsOpen(true)}>•••</button></div>
            {selected.liveContextShared ? <div className="live-card"><div className="live-map" aria-hidden="true"><span className="road road-one" /><span className="road road-two" /><span className="map-pin"><i /></span></div><div className="live-primary"><span className="live-label"><i /> Live context</span><h2>{selected.location}</h2><p>{selected.eta}</p></div><div className="live-stats"><div><span>{selected.activity}</span><strong>{selected.speed}</strong></div><div><span>Weather</span><strong>{selected.temperature} <small>{selected.weather}</small></strong></div><div><span>Battery</span><strong>{selected.battery == null ? "—" : `${selected.battery}%`} <small>{selected.battery == null ? "Unavailable" : selected.charging ? "Charging" : selected.battery > 25 ? "Good" : "Low"}</small></strong></div></div><button className="live-more" aria-label="Open live map" onClick={() => setToast(`${selected.name} is near ${selected.location}.`)}>↗</button></div> : <div className="private-card"><span>◎</span><div><strong>{selected.name}’s live context is private</strong><p>Location, weather, and battery appear here when {selected.name} shares them with you.</p></div><button onClick={() => toggleLocation(selected)}>{selected.locationShared ? "Pause mine" : "Share mine"}</button></div>}
            <div className="messages" ref={messagesRef} role="log" aria-live="polite" aria-relevant="additions text"><div className="day-label">Today</div>{activeMessages.map((message) => { const kind = message.kind ?? "text"; const visualMedia = kind === "image" || kind === "video"; return <div className={`bubble ${message.from === "me" ? "outgoing" : "incoming"} ${kind !== "text" ? "media-bubble" : ""} ${visualMedia ? "visual-media-bubble" : ""} ${kind === "image" ? "image-media-bubble" : ""} ${kind === "audio" ? "audio-media-bubble" : ""}`} key={message.id}>{kind === "text" ? message.text : <MediaMessage message={message} onPreview={openPhotoPreview} />}<time>{formatMessageTime(message.createdAt, message.from === "me")}</time></div>; })}</div>
            <form className={`composer ${recording ? "is-recording" : ""}`} onSubmit={sendMessage}>
              <div className="composer-tool attachment-tool">
                <button type="button" className={`round-action ${attachmentMenuOpen ? "active" : ""}`} aria-label="Share a photo, video, or document" aria-expanded={attachmentMenuOpen} onClick={() => { setAttachmentMenuOpen((value) => !value); setEmojiOpen(false); }}>+</button>
                <input ref={photoInputRef} hidden type="file" accept="image/*" onChange={(event) => { void sendFile(event, "image"); }} />
                <input ref={videoInputRef} hidden type="file" accept="video/*" onChange={(event) => { void sendFile(event, "video"); }} />
                <input ref={documentInputRef} hidden type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.zip,.pages,.numbers,.key,application/pdf,text/plain,text/csv,application/zip" onChange={(event) => { void sendFile(event, "document"); }} />
                {attachmentMenuOpen && <div className="attachment-menu" role="menu"><button type="button" role="menuitem" onClick={() => photoInputRef.current?.click()}><i>▧</i><span><strong>Photo</strong><small>Choose an image</small></span></button><button type="button" role="menuitem" onClick={() => videoInputRef.current?.click()}><i>▷</i><span><strong>Video</strong><small>Choose a video</small></span></button><button type="button" role="menuitem" onClick={() => documentInputRef.current?.click()}><i>≡</i><span><strong>Document</strong><small>PDF, Office, text or ZIP</small></span></button></div>}
              </div>
              {recording ? <div className="recording-status" role="status"><i /><span><strong>Recording voice</strong><small>{Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, "0")} · tap stop to send</small></span></div> : <label><input aria-label={`Message ${selected.name}`} enterKeyHint="send" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={`Message ${selected.name}`} /></label>}
              <div className="composer-tool emoji-tool">
                <button type="button" className={`emoji-button ${emojiOpen ? "active" : ""}`} aria-label="Choose an emoji" aria-expanded={emojiOpen} onClick={() => { setEmojiOpen((value) => !value); setAttachmentMenuOpen(false); }}>☺</button>
                {emojiOpen && <div className="emoji-picker" aria-label="Emoji picker">{emojis.map((emoji) => <button type="button" key={emoji} aria-label={`Add ${emoji}`} onClick={() => { setDraft((current) => `${current}${emoji}`); setEmojiOpen(false); }}>{emoji}</button>)}</div>}
              </div>
              <button type="button" className={`voice-button ${recording ? "recording" : ""}`} aria-label={recording ? "Stop and send voice message" : "Record a voice message"} aria-pressed={recording} onClick={() => { void startVoiceRecording(); }}>{recording ? "■" : "⌇"}</button>
              <button type="submit" className="send-button" aria-label="Send message" disabled={recording || !draft.trim()}>↑</button>
            </form></> : <div className="empty-chat-state"><span>◎</span><h2>Your circle is empty</h2><p>Invite another Famochat account by username to begin.</p><button className="primary-button" onClick={() => setAddOpen(true)}>Add a person <b>+</b></button></div>}
          </section>
        </div>
      </section>

      {addOpen && <AddPersonModal onClose={() => setAddOpen(false)} onAdd={async (payload) => { const error = await onSendRequest(payload); if (!error) { setAddOpen(false); setToast(`Request sent to @${payload.username}.`); } return error; }} />}

      {noticesOpen && <div className="modal-backdrop" onMouseDown={() => setNoticesOpen(false)}><section className="glass-modal request-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-handle" /><header><div><span className="kicker">Relationship requests</span><h2>Your inbox</h2></div><button className="close-button" onClick={() => setNoticesOpen(false)}>×</button></header>{account.requests.length > 0 ? <div className="request-stack">{account.requests.map((request) => <div className="request-card" key={request.id}><span className={`avatar ${toneFor(request.fromUsername)}`}>{initials(request.fromName)}<i className="online" /></span><div><strong>{request.fromName}</strong><p><b>@{request.fromUsername}</b> wants to add you as <b>{request.relation}</b>.</p><span className="category-chip">{request.category}</span></div><div className="request-actions"><button onClick={() => { void onDeclineRequest(request).then((error) => { if (error) setToast(error); }); }}>Decline</button><button className="dark" onClick={() => { void onApproveRequest(request).then((error) => setToast(error || `${request.fromName} is now in your circle.`)); }}>Approve</button></div></div>)}</div> : <div className="request-done request-empty"><span>◇</span><strong>No requests yet</strong><p>Requests sent to this username will appear here.</p></div>}<div className="modal-note">Relationship requests sync automatically across signed-in devices.</div></section></div>}

      {detailsOpen && selected && <div className="modal-backdrop" onMouseDown={() => setDetailsOpen(false)}><section className="glass-modal contact-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-handle" /><header><div><span className="kicker">Conversation details</span><h2>{selected.name}</h2></div><button className="close-button" onClick={() => setDetailsOpen(false)}>×</button></header><div className="contact-profile"><span className={`avatar contact-avatar ${selected.tone}`}>{initials(selected.name)}<i className={selected.online ? "online" : "offline"} /></span><strong>{selected.name}</strong><small>@{selected.username}</small></div><div className="contact-settings"><div><span>Relationship</span><strong>{selected.relation}</strong></div><div><span>Circle</span><strong>{selected.category}</strong></div><button onClick={() => { setDetailsOpen(false); toggleLocation(selected); }}><span>Location sharing</span><strong>{selected.locationShared ? selected.parentalControl ? "On · Parental control" : "On" : "Off"} <i>›</i></strong></button></div><button className="danger-button" disabled={selected.contactRemovalLocked} onClick={() => { if (selected.contactRemovalLocked) return; setDetailsOpen(false); setRemoveTarget(selected); }}><span>{selected.contactRemovalLocked ? "◇" : "−"}</span><div><strong>{selected.contactRemovalLocked ? "Contact protected" : "Remove from circle"}</strong><small>{selected.contactRemovalLocked ? "Parental control prevents either person from deleting this contact" : "Ends chat access and location sharing"}</small></div><b>{selected.contactRemovalLocked ? "Locked" : "›"}</b></button></section></div>}
      {removeTarget && <div className="modal-backdrop"><section className="glass-modal safety-modal remove-modal" role="alertdialog" aria-modal="true" aria-labelledby="remove-contact-title"><div className="safety-icon remove-icon">−</div><span className="kicker">Remove contact</span><h2 id="remove-contact-title">Remove {removeTarget.name}?</h2><p>They’ll be removed from both circles, location sharing will stop, and this conversation will no longer appear.</p><div className="remove-actions"><button className="secondary-button" onClick={() => setRemoveTarget(null)}>Keep contact</button><button className="danger-confirm" onClick={() => { void removeContact(removeTarget); }}>Remove {removeTarget.name}</button></div></section></div>}
      {parentPrompt && <div className="modal-backdrop"><section className="glass-modal safety-modal"><div className="safety-icon">⌖<i /></div><span className="kicker">Family location</span><h2>Share with {parentPrompt.name}</h2><p>Would you also like to give {parentPrompt.name} parental control? With it on, your location can only be paused after they approve.</p><div className="setting-preview"><div><span>Parental control</span><small>Requires two-person approval to turn off</small></div><span className="mini-switch on"><i /></span></div><button className="primary-button" onClick={() => { updatePerson(parentPrompt.id, { locationShared: true, parentalControl: true }); setParentPrompt(null); setToast(`${parentPrompt.name} now has parental location control.`); }}>Share with parental control</button><button className="secondary-button full" onClick={() => { updatePerson(parentPrompt.id, { locationShared: true }); setParentPrompt(null); setToast(`Location shared with ${parentPrompt.name}.`); }}>Share location only</button><button className="text-button" onClick={() => setParentPrompt(null)}>Cancel</button></section></div>}
      {lockRequest && <div className="modal-backdrop"><section className="glass-modal safety-modal"><div className="safety-icon lock-icon">◇</div><span className="kicker">Two-person safety</span><h2>Ask {lockRequest.name} to pause?</h2><p>Parental control is active. {lockRequest.name} needs to approve before your location sharing can turn off.</p><div className="approval-flow"><span className="avatar you-avatar">{userInitials}</span><i /><span className={`avatar ${lockRequest.tone}`}>{initials(lockRequest.name)}</span></div><button className="primary-button" onClick={() => { setLockRequest(null); setToast(`Pause request sent to ${lockRequest.name}. Location stays on for now.`); }}>Send approval request <span>→</span></button><button className="text-button" onClick={() => setLockRequest(null)}>Keep sharing</button></section></div>}
      {previewMessage && <div className="media-lightbox" role="dialog" aria-modal="true" aria-label="Photo preview" onMouseDown={() => setPreviewMessage(null)}><button className="media-lightbox-close" aria-label="Close photo preview" onClick={() => setPreviewMessage(null)}>×</button><button className="media-lightbox-zoom" aria-label={previewZoomed ? "Fit photo to screen" : "Zoom photo to two times size"} onMouseDown={(event) => event.stopPropagation()} onClick={() => setPreviewZoomed((value) => !value)}>{previewZoomed ? "Fit" : "Zoom 2×"}</button><div className={`media-lightbox-content ${previewZoomed ? "zoomed" : ""}`} onMouseDown={(event) => event.stopPropagation()}><button type="button" className="media-lightbox-image" aria-label={previewZoomed ? "Fit photo to screen" : "Zoom photo to two times size"} onClick={() => setPreviewZoomed((value) => !value)}><MediaMessage message={previewMessage} /></button><span>{previewMessage.fileName || "Shared photo"} · {previewZoomed ? "Drag to explore · tap to fit" : "Tap to zoom"}</span></div></div>}
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}

function AddPersonModal({ onClose, onAdd }: { onClose: () => void; onAdd: (payload: AddPersonPayload) => Promise<string | null> }) {
  const [username, setUsername] = useState("");
  const [category, setCategory] = useState<CircleType>("Family");
  const [relation, setRelation] = useState("");
  const [error, setError] = useState("");
  const helper = useMemo(() => ({ Family: "For immediate family and care features", Relative: "For extended family you trust", "Close friend": "For the friends who feel like family" })[category], [category]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cleanUsername = username.replace(/^@/, "").trim().toLowerCase();
    if (!/^[A-Za-z0-9]{3,}$/.test(cleanUsername)) { setError("Enter a valid username with at least 3 letters or numbers."); return; }
    if (relation.trim().length < 2) { setError("Add the relationship you want them to approve."); return; }
    const result = await onAdd({ username: cleanUsername, category, relation: relation.trim() });
    if (result) setError(result);
  };
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="glass-modal add-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-handle" /><header><div><span className="kicker">Grow your circle</span><h2>Add a person</h2></div><button className="close-button" onClick={onClose}>×</button></header><form onSubmit={submit}><label className="field"><span>Their username</span><div className="input-prefix"><b>@</b><input autoFocus value={username} onChange={(event) => { setUsername(event.target.value); setError(""); }} placeholder="username" /></div><small>They need an active Famochat account.</small></label><fieldset className="circle-picker"><legend>Keep them as</legend>{(["Family", "Relative", "Close friend"] as CircleType[]).map((item) => <button key={item} type="button" className={category === item ? "selected" : ""} onClick={() => setCategory(item)}><i>{item === "Family" ? "⌂" : item === "Relative" ? "◎" : "♡"}</i><span>{item}</span><b>{category === item ? "✓" : ""}</b></button>)}</fieldset><p className="picker-help">{helper}</p><label className="field"><span>Your relationship</span><input value={relation} onChange={(event) => { setRelation(event.target.value); setError(""); }} placeholder="e.g. daughter, uncle, best friend" /><small>They’ll approve this exact relationship before chat opens.</small></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button form-submit" type="submit">Send relationship request <span>→</span></button></form></section></div>;
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [account, setAccount] = useState<Account | null>(null);
  const [locationPermission, setLocationPermission] = useState<LocationPermission>("checking");
  const [locationPromptOpen, setLocationPromptOpen] = useState(true);
  const [requestingLocation, setRequestingLocation] = useState(false);
  const locationSharingActive = account?.contacts.some((contact) => contact.locationShared) ?? false;

  const requestLocation = useCallback(() => new Promise<boolean>((resolve) => {
    if (!("geolocation" in navigator)) {
      setLocationPermission("unavailable");
      setLocationPromptOpen(true);
      resolve(false);
      return;
    }

    setRequestingLocation(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        setLocationPermission("granted");
        setLocationPromptOpen(false);
        try {
          const context = await collectLiveContext(position);
          const next = await accountRequest("/api/actions", {
            method: "POST",
            body: JSON.stringify({ action: "update-live-context", ...context }),
          });
          if (next) setAccount(next);
        } catch {
          // Location sharing still succeeds when optional context services are unavailable.
        }
        setRequestingLocation(false);
        resolve(true);
      },
      (error) => {
        setLocationPermission(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable");
        setRequestingLocation(false);
        resolve(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  }), []);

  useEffect(() => {
    let permissionStatus: PermissionStatus | undefined;
    let active = true;

    const checkPermission = async () => {
      if (!("geolocation" in navigator)) {
        setLocationPermission("unavailable");
        setLocationPromptOpen(true);
        return;
      }

      if (navigator.permissions) {
        try {
          permissionStatus = await navigator.permissions.query({ name: "geolocation" });
          if (!active) return;
          permissionStatus.onchange = () => {
            if (!permissionStatus) return;
            setLocationPermission(permissionStatus.state);
            setLocationPromptOpen(permissionStatus.state !== "granted");
          };
          if (permissionStatus.state === "granted") {
            setLocationPermission("granted");
            setLocationPromptOpen(false);
            return;
          }
          if (permissionStatus.state === "denied") {
            setLocationPermission("denied");
            setLocationPromptOpen(true);
            return;
          }
        } catch { /* The geolocation request below is the cross-browser fallback. */ }
      }

      setLocationPermission("prompt");
      setLocationPromptOpen(true);
    };

    void checkPermission();
    return () => {
      active = false;
      if (permissionStatus) permissionStatus.onchange = null;
    };
  }, [requestLocation]);

  const refreshAccount = useCallback(async () => {
    try {
      const next = await accountRequest("/api/state", { cache: "no-store" });
      if (next) setAccount(next);
      return next;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let active = true;
    void accountRequest("/api/state", { cache: "no-store" })
      .then((next) => {
        if (!active || !next) return;
        setAccount(next);
        setScreen("app");
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (screen !== "app") return;
    const sync = () => { void refreshAccount(); };
    const timer = window.setInterval(sync, 5000);
    window.addEventListener("focus", sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", sync);
    };
  }, [refreshAccount, screen]);

  useEffect(() => {
    if (screen !== "app" || !locationSharingActive) return;
    const update = () => { void requestLocation(); };
    update();
    const timer = window.setInterval(update, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [locationSharingActive, requestLocation, screen]);

  const performAction = async (payload: Record<string, unknown>) => {
    try {
      const next = await accountRequest("/api/actions", { method: "POST", body: JSON.stringify(payload) });
      if (next) setAccount(next);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Something went wrong. Please try again.";
    }
  };

  const authenticate = async (payload: AuthPayload) => {
    try {
      const next = await accountRequest("/api/auth", { method: "POST", body: JSON.stringify(payload) });
      if (!next) return "The account could not be loaded.";
      setAccount(next);
      setScreen("app");
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Sign in failed. Please try again.";
    }
  };

  const sendRequest = (payload: AddPersonPayload) => performAction({ action: "send-request", ...payload });

  const approveRequest = (request: RelationshipRequest) => performAction({ action: "approve-request", requestId: request.id });

  const declineRequest = (request: RelationshipRequest) => performAction({ action: "decline-request", requestId: request.id });

  const removeContact = (username: string) => performAction({ action: "remove-contact", username });
  const updateContact = (username: string, patch: Pick<Person, "locationShared" | "parentalControl">) => performAction({ action: "update-contact", username, ...patch });
  const sendMessage = (username: string, message: OutgoingMessage) => performAction({ action: "send-message", username, ...message });

  const signOut = async () => {
    try {
      await accountRequest("/api/auth", { method: "DELETE" });
    } finally {
      setAccount(null);
      setScreen("signin");
    }
  };

  const locationDialog = locationPromptOpen && <LocationAccessModal status={locationPermission} busy={requestingLocation} onAllow={() => { void requestLocation(); }} onClose={() => setLocationPromptOpen(false)} />;
  if (screen === "welcome") return <><Welcome onScreen={setScreen} />{locationDialog}</>;
  if (screen === "signup" || screen === "signin") return <><AuthForm mode={screen} onBack={() => setScreen("welcome")} onAuthenticate={authenticate} onSwitch={() => setScreen(screen === "signup" ? "signin" : "signup")} />{locationDialog}</>;
  if (!account) return <><Welcome onScreen={setScreen} />{locationDialog}</>;
  return <><Messenger key={account.username} account={account} onSignOut={signOut} onUpdateContact={updateContact} onSendRequest={sendRequest} onApproveRequest={approveRequest} onDeclineRequest={declineRequest} onRemoveContact={removeContact} onSendMessage={sendMessage} onRequestLocation={requestLocation} />{locationDialog}</>;
}
