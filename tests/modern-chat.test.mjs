import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("persists modern message lifecycle, presence, reactions, and typing state", async () => {
  const [database, schema, actions, state] = await Promise.all([
    readFile(new URL("db/index.ts", root), "utf8"),
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL("app/api/actions/route.ts", root), "utf8"),
    readFile(new URL("lib/state.ts", root), "utf8"),
  ]);

  for (const column of ["client_id", "reply_to_id", "edited_at", "deleted_at", "read_at"]) {
    assert.match(database, new RegExp(column));
  }
  assert.match(database, /CREATE TABLE IF NOT EXISTS message_reactions/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS typing_indicators/);
  assert.match(schema, /messageReactions/);
  assert.match(schema, /typingIndicators/);
  for (const action of ["mark-read", "typing", "react-message", "edit-message", "delete-message"]) {
    assert.match(actions, new RegExp(`action === "${action}"`));
  }
  assert.match(actions, /INSERT OR IGNORE INTO messages/);
  assert.match(actions, /clientId/);
  assert.match(state, /unreadCount/);
  assert.match(state, /lastMessagePreview/);
  assert.match(state, /last_seen_at/);
});

test("offers modern conversation controls and mobile account logout", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  for (const control of ["Reply", "Edit", "Remove for everyone", "Search conversation", "Newest messages", "Seen"]) {
    assert.match(page, new RegExp(control));
  }
  assert.match(page, /className="profile-menu sidebar-profile-menu"/);
  assert.match(page, />Log out </);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.you-card \{ display: grid; \}/);
  assert.match(css, /\.typing-indicator/);
  assert.match(css, /\.reaction-chips/);
  assert.match(css, /\.message-actions-menu/);
  assert.match(css, /\.composer textarea/);
});
