import assert from "node:assert/strict";
import test from "node:test";

import { signCloudinaryParameters, verifyCloudinaryUploadSignature } from "../lib/cloudinary.ts";
import {
  cloudinaryAudioFallbackUrl,
  cloudinaryImageDisplayUrl,
  cloudinaryResourceType,
  cloudinaryUploadUrl,
  parseCloudinaryUploadResponse,
} from "../lib/media.ts";
import { serializeMessageRow, serializeMessageRows } from "../lib/messages.ts";

const cloudName = "famo-cloud";
const apiSecret = "test-secret";

function uploadResponse(resourceType, format, publicId, version, bytes) {
  return {
    secure_url: `https://res.cloudinary.com/${cloudName}/${resourceType}/upload/v${version}/${publicId}.${format}`,
    public_id: publicId,
    resource_type: resourceType,
    format,
    bytes,
    version,
    type: "upload",
    signature: signCloudinaryParameters({ public_id: publicId, version }, apiSecret),
  };
}

test("uses explicit Cloudinary asset types for images and recorded audio", () => {
  assert.equal(cloudinaryResourceType("image"), "image");
  assert.equal(cloudinaryResourceType("audio"), "video");
  assert.equal(cloudinaryUploadUrl(cloudName, "image"), `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`);
  assert.equal(cloudinaryUploadUrl(cloudName, "video"), `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`);
});

test("accepts a complete public upload response and rejects a broken media URL", () => {
  const response = uploadResponse("image", "jpg", "famochat/user-a/photo", 123456, 24000);
  const parsed = parseCloudinaryUploadResponse(response, cloudName, "image");
  assert.equal(parsed.mediaUrl, response.secure_url);
  assert.equal(parsed.mediaPublicId, response.public_id);
  assert.equal(parsed.mediaResourceType, "image");
  assert.equal(parsed.mediaBytes, 24000);
  assert.equal(verifyCloudinaryUploadSignature({ publicId: response.public_id, version: response.version, signature: response.signature, apiSecret }), true);
  assert.throws(() => parseCloudinaryUploadResponse({ ...response, secure_url: "https://example.com/broken.jpg" }, cloudName, "image"), /invalid delivery URL/);
});

test("serializes the same persistent image for sender, receiver, and history", () => {
  const upload = uploadResponse("image", "jpg", "famochat/user-a/photo", 123456, 24000);
  const row = {
    id: 91,
    sender_id: "user-a",
    recipient_id: "user-b",
    sender_username: "alice",
    recipient_username: "bob",
    text: "",
    kind: "image",
    media_url: upload.secure_url,
    media_public_id: upload.public_id,
    media_resource_type: upload.resource_type,
    media_format: upload.format,
    media_bytes: upload.bytes,
    mime_type: "image/jpeg",
    file_name: "photo.jpg",
    duration: null,
    created_at: 123456789,
  };
  const sender = serializeMessageRow(row, "user-a");
  const receiver = serializeMessageRow(row, "user-b");
  assert.equal(sender.partner, "bob");
  assert.equal(receiver.partner, "alice");
  assert.equal(sender.message.from, "me");
  assert.equal(receiver.message.from, "them");
  assert.equal(sender.message.senderId, "user-a");
  assert.equal(receiver.message.recipientId, "user-b");
  assert.deepEqual({ ...sender.message, from: "them" }, receiver.message);
  assert.equal(sender.message.mediaUrl, upload.secure_url);
});

test("preserves playable voice metadata and supplies a cross-browser MP3 fallback", () => {
  const upload = uploadResponse("video", "webm", "famochat/user-a/voice", 987654, 18000);
  const row = {
    id: 92,
    sender_id: "user-a",
    recipient_id: "user-b",
    sender_username: "alice",
    recipient_username: "bob",
    text: "",
    kind: "audio",
    media_url: upload.secure_url,
    media_public_id: upload.public_id,
    media_resource_type: upload.resource_type,
    media_format: upload.format,
    media_bytes: upload.bytes,
    mime_type: "audio/webm;codecs=opus",
    file_name: "voice-987654.webm",
    duration: 8,
    created_at: 123456790,
  };
  const sender = serializeMessageRow(row, "user-a").message;
  const receiver = serializeMessageRow(row, "user-b").message;
  assert.equal(sender.mediaUrl, receiver.mediaUrl);
  assert.equal(sender.duration, 8);
  assert.equal(sender.mimeType, "audio/webm;codecs=opus");
  assert.equal(cloudinaryAudioFallbackUrl(sender.mediaUrl), "https://res.cloudinary.com/famo-cloud/video/upload/f_mp3/v987654/famochat/user-a/voice.mp3");
  assert.equal(cloudinaryImageDisplayUrl("https://res.cloudinary.com/famo-cloud/image/upload/v1/famochat/a/photo.jpg"), "https://res.cloudinary.com/famo-cloud/image/upload/f_auto,q_auto,c_limit,w_1600,h_1600/v1/famochat/a/photo.jpg");
});

test("preserves text, image, and audio order by timestamp and message ID", () => {
  const base = { sender_id: "user-a", recipient_id: "user-b", sender_username: "alice", recipient_username: "bob", text: "", media_url: null, media_public_id: null, media_resource_type: null, media_format: null, media_bytes: null, mime_type: null, file_name: null, duration: null };
  const rows = [
    { ...base, id: 3, kind: "audio", created_at: 300 },
    { ...base, id: 2, kind: "image", created_at: 200 },
    { ...base, id: 1, kind: "text", text: "hello", created_at: 100 },
    { ...base, id: 4, kind: "text", text: "same time", created_at: 300 },
  ];
  const ordered = serializeMessageRows(rows, "user-a").map(({ message }) => `${message.id}:${message.kind}`);
  assert.deepEqual(ordered, ["1:text", "2:image", "3:audio", "4:text"]);
});
