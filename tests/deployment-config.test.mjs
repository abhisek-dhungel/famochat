import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("uses the Vercel-native Next.js build", async () => {
  const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.equal(packageJson.scripts.build, "next build");
  assert.ok(packageJson.dependencies.next);
  assert.ok(packageJson.dependencies["@libsql/client"]);
  assert.equal(packageJson.devDependencies?.vinext, undefined);
  assert.equal(packageJson.devDependencies?.wrangler, undefined);
});

test("documents every production service secret without committing values", async () => {
  const envExample = await readFile(new URL(".env.example", root), "utf8");
  for (const key of [
    "TURSO_DATABASE_URL",
    "TURSO_AUTH_TOKEN",
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
  ]) {
    assert.match(envExample, new RegExp(`^${key}=`, "m"));
    if (process.env[key]) assert.equal(envExample.includes(process.env[key]), false);
  }
});

test("keeps passwords and Cloudinary signing secrets on the server", async () => {
  const [page, authRoute, signatureRoute] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/api/auth/route.ts", root), "utf8"),
    readFile(new URL("app/api/media/signature/route.ts", root), "utf8"),
  ]);
  assert.doesNotMatch(page, /localStorage|indexedDB|CLOUDINARY_API_SECRET|passwordHash|passwordSalt/);
  assert.match(authRoute, /createPassword|startSession/);
  assert.match(signatureRoute, /CLOUDINARY_API_SECRET/);
});

test("keeps the mobile message composer stable when the keyboard opens", async () => {
  const [css, page] = await Promise.all([
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
  ]);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.composer textarea \{[^}]*font-size:\s*16px/);
  assert.match(css, /\.composer \{[^}]*max-width:\s*calc\(100vw - 18px\)/);
  assert.match(css, /\.composer textarea \{[^}]*min-width:\s*0/);
  assert.match(page, /enterKeyHint="send"/);
  assert.match(page, /event\.key === "Enter" && !event\.shiftKey[^}]*requestSubmit\(\)/);
});

test("keeps desktop chat history in its own scrollable area", async () => {
  const css = await readFile(new URL("app/globals.css", root), "utf8");
  assert.match(css, /\.chat-pane \{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden/);
  assert.match(css, /\.messages \{[^}]*flex:\s*1 1 0;[^}]*overflow-y:\s*auto/);
});

test("formats message timestamps in the viewer's local timezone", async () => {
  const [messages, page] = await Promise.all([
    readFile(new URL("lib/messages.ts", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
  ]);
  assert.match(messages, /createdAt:\s*Number\(row\.created_at\)/);
  assert.doesNotMatch(messages, /toLocaleTimeString/);
  assert.match(page, /new Intl\.DateTimeFormat\(undefined, \{ hour: "numeric", minute: "2-digit" \}\)/);
  assert.match(page, /formatMessageTime\(message\.createdAt/);
});

test("renders Instagram-style photo cards with delivery feedback and a custom voice-message waveform", async () => {
  const [mediaMessage, page, css] = await Promise.all([
    readFile(new URL("components/media-message.tsx", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);
  assert.match(mediaMessage, /function AudioMessage/);
  assert.match(mediaMessage, /className="audio-waveform"/);
  assert.doesNotMatch(mediaMessage, /<audio[^>]*controls/);
  assert.match(css, /\.bubble\.media-bubble\.visual-media-bubble \{[^}]*width:\s*min\(320px, 72vw\)/);
  assert.match(css, /\.message-image,[^}]*object-fit:\s*cover/);
  assert.doesNotMatch(css, /\.message-image[^}]*opacity:\s*0/);
  assert.match(mediaMessage, /loading="eager"/);
  assert.doesNotMatch(mediaMessage, /cloudinaryImageDisplayUrl/);
  assert.match(mediaMessage, /\/api\/media\/image\?url=/);
  assert.match(page, /className="media-send-progress"/);
  assert.match(page, /Couldn’t send photo/);
  assert.match(page, /Retry/);
  assert.match(css, /\.media-send-overlay \{[^}]*position:\s*absolute/);
  assert.match(css, /\.message-audio audio \{\s*display:\s*none/);
});

test("verifies and persists complete Cloudinary media metadata", async () => {
  const [signatureRoute, imageRoute, actions, database, state] = await Promise.all([
    readFile(new URL("app/api/media/signature/route.ts", root), "utf8"),
    readFile(new URL("app/api/media/image/route.ts", root), "utf8"),
    readFile(new URL("app/api/actions/route.ts", root), "utf8"),
    readFile(new URL("db/index.ts", root), "utf8"),
    readFile(new URL("lib/state.ts", root), "utf8"),
  ]);
  assert.match(signatureRoute, /cloudinaryResourceType\(kind\)/);
  assert.match(actions, /verifyCloudinaryUploadSignature/);
  assert.match(actions, /isCloudinaryDeliveryUrl/);
  assert.match(imageRoute, /parsed\.hostname !== "res\.cloudinary\.com"/);
  assert.match(imageRoute, /sender_id = \? OR recipient_id = \?/);
  assert.match(database, /ensureMessageColumns/);
  assert.match(database, /media_resource_type TEXT/);
  assert.match(state, /serializeMessageRow/);
});

test("uses the wordmark in-app and the green-dot f favicon", async () => {
  const [layout, manifest, page, favicon, appleIcon, icon192, icon512] = await Promise.all([
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/manifest.ts", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("public/favicon.svg", root), "utf8"),
    readFile(new URL("public/apple-touch-icon.png", root)),
    readFile(new URL("public/icon-192.png", root)),
    readFile(new URL("public/icon-512.png", root)),
  ]);
  assert.match(layout, /const title = "Famochat"/);
  assert.doesNotMatch(layout, /Keep your people close/);
  assert.match(layout, /manifest: "\/manifest\.webmanifest"/);
  assert.match(layout, /apple-touch-icon\.png/);
  assert.match(layout, /appleWebApp/);
  assert.match(manifest, /icon-192\.png/);
  assert.match(manifest, /icon-512\.png/);
  assert.match(manifest, /purpose: "any"/);
  assert.match(manifest, /purpose: "maskable"/);
  assert.match(page, /className="brand-famo">famo<\/strong><span className="brand-chat">chat<\/span>/);
  assert.match(favicon, /fill="#FFFFFF"/);
  assert.match(favicon, /fill="#080808"/);
  assert.match(favicon, /fill="#27A85F"/);
  assert.match(favicon, />f<\/text>/);
  assert.deepEqual([appleIcon.readUInt32BE(16), appleIcon.readUInt32BE(20)], [180, 180]);
  assert.deepEqual([icon192.readUInt32BE(16), icon192.readUInt32BE(20)], [192, 192]);
  assert.deepEqual([icon512.readUInt32BE(16), icon512.readUInt32BE(20)], [512, 512]);
});

test("persists live context only for contacts it is shared with", async () => {
  const [database, state, actions] = await Promise.all([
    readFile(new URL("db/index.ts", root), "utf8"),
    readFile(new URL("lib/state.ts", root), "utf8"),
    readFile(new URL("app/api/actions/route.ts", root), "utf8"),
  ]);
  assert.match(database, /CREATE TABLE IF NOT EXISTS live_contexts/);
  assert.match(state, /shared\.owner_id = c\.contact_id/);
  assert.match(state, /shared\.location_shared = 1/);
  assert.match(actions, /action === "update-live-context"/);
});

test("blocks contact deletion while parental control is active", async () => {
  const [page, actions] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/api/actions/route.ts", root), "utf8"),
  ]);
  assert.match(page, /disabled=\{selected\.contactRemovalLocked\}/);
  assert.match(actions, /parental_control = 1/);
  assert.match(actions, /protected by parental control and cannot be deleted/);
});

test("delivers parental location pause approvals through the synchronized inbox", async () => {
  const [database, schema, state, actions, page] = await Promise.all([
    readFile(new URL("db/index.ts", root), "utf8"),
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL("lib/state.ts", root), "utf8"),
    readFile(new URL("app/api/actions/route.ts", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
  ]);
  assert.match(database, /CREATE TABLE IF NOT EXISTS location_pause_requests/);
  assert.match(schema, /locationPauseRequests/);
  assert.match(state, /pauseRequests:/);
  assert.match(state, /pauseRequestPending:/);
  assert.match(actions, /action === "request-location-pause"/);
  assert.match(actions, /action === "approve-location-pause"/);
  assert.match(actions, /action === "decline-location-pause"/);
  assert.match(page, /onSendPauseRequest\(target\.username\)/);
  assert.match(page, /Approve pause/);
});
