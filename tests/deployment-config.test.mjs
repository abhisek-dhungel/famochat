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
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.composer input \{[^}]*font-size:\s*16px/);
  assert.match(css, /\.composer \{[^}]*max-width:\s*calc\(100vw - 18px\)/);
  assert.match(css, /\.composer input \{[^}]*min-width:\s*0/);
  assert.match(page, /enterKeyHint="send"/);
  assert.match(page, /event\.key === "Enter"[^}]*requestSubmit\(\)/);
});

test("keeps desktop chat history in its own scrollable area", async () => {
  const css = await readFile(new URL("app/globals.css", root), "utf8");
  assert.match(css, /\.chat-pane \{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden/);
  assert.match(css, /\.messages \{[^}]*flex:\s*1 1 0;[^}]*overflow-y:\s*auto/);
});

test("formats message timestamps in the viewer's local timezone", async () => {
  const [state, page] = await Promise.all([
    readFile(new URL("lib/state.ts", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
  ]);
  assert.match(state, /createdAt:\s*Number\(row\.created_at\)/);
  assert.doesNotMatch(state, /toLocaleTimeString/);
  assert.match(page, /new Intl\.DateTimeFormat\(undefined, \{ hour: "numeric", minute: "2-digit" \}\)/);
  assert.match(page, /formatMessageTime\(message\.createdAt/);
});

test("renders compact photo previews and a custom voice-message waveform", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);
  assert.match(page, /function AudioMessage/);
  assert.match(page, /className="audio-waveform"/);
  assert.doesNotMatch(page, /<audio[^>]*controls/);
  assert.match(css, /\.bubble\.media-bubble\.visual-media-bubble \{[^}]*width:\s*min\(300px, 72vw\)/);
  assert.match(css, /\.message-image,[^}]*object-fit:\s*cover/);
  assert.match(css, /\.message-audio audio \{\s*display:\s*none/);
});

test("uses the black f logo on white with a green dot", async () => {
  const [layout, page, css, favicon] = await Promise.all([
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("public/favicon.svg", root), "utf8"),
  ]);
  assert.match(layout, /const title = "Famochat"/);
  assert.doesNotMatch(layout, /Keep your people close/);
  assert.match(page, /className="brand"[^>]*><strong[^>]*>f<\/strong><i className="brand-dot"/);
  assert.match(css, /\.brand \{[^}]*background:\s*#fff;[^}]*color:\s*#080808/);
  assert.match(css, /\.brand-dot \{[^}]*background:\s*var\(--green\)/);
  assert.match(favicon, /fill="#FFFFFF"/);
  assert.match(favicon, /fill="#080808"/);
  assert.match(favicon, /fill="#27A85F"/);
  assert.match(favicon, />f<\/text>/);
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
