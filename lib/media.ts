export type MediaMessageKind = "text" | "image" | "video" | "audio" | "document";
export type CloudinaryResourceType = "image" | "video" | "raw";

export type CompletedCloudinaryUpload = {
  mediaUrl: string;
  mediaPublicId: string;
  mediaResourceType: CloudinaryResourceType;
  mediaFormat: string;
  mediaBytes: number;
  uploadVersion: number;
  uploadSignature: string;
};

export function cloudinaryResourceType(kind: MediaMessageKind): CloudinaryResourceType {
  if (kind === "image") return "image";
  if (kind === "video" || kind === "audio") return "video";
  return "raw";
}

export function cloudinaryUploadUrl(cloudName: string, resourceType: CloudinaryResourceType) {
  return `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${resourceType}/upload`;
}

export function isCloudinaryDeliveryUrl({
  url,
  cloudName,
  resourceType,
  publicId,
  version,
  format,
}: {
  url: string;
  cloudName: string;
  resourceType: CloudinaryResourceType;
  publicId: string;
  version: number;
  format: string;
}) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "res.cloudinary.com" || parsed.search || parsed.hash) return false;
    const expectedPath = `/${cloudName}/${resourceType}/upload/v${version}/${publicId}.${format}`;
    return decodeURIComponent(parsed.pathname) === expectedPath;
  } catch {
    return false;
  }
}

export function parseCloudinaryUploadResponse(
  input: unknown,
  cloudName: string,
  expectedResourceType: CloudinaryResourceType,
): CompletedCloudinaryUpload {
  const data = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const mediaUrl = typeof data.secure_url === "string" ? data.secure_url : "";
  const mediaPublicId = typeof data.public_id === "string" ? data.public_id : "";
  const mediaResourceType = typeof data.resource_type === "string" ? data.resource_type : "";
  const mediaFormat = typeof data.format === "string" ? data.format : "";
  const mediaBytes = typeof data.bytes === "number" ? Math.round(data.bytes) : 0;
  const uploadVersion = typeof data.version === "number" ? Math.round(data.version) : 0;
  const uploadSignature = typeof data.signature === "string" ? data.signature : "";
  const deliveryType = typeof data.type === "string" ? data.type : "";

  if (mediaResourceType !== expectedResourceType || deliveryType !== "upload") {
    throw new Error("Cloudinary returned an unexpected asset type.");
  }
  if (!mediaPublicId || !mediaFormat || mediaBytes <= 0 || uploadVersion <= 0 || !/^[a-f0-9]{40,64}$/i.test(uploadSignature)) {
    throw new Error("Cloudinary returned incomplete upload metadata.");
  }
  if (!isCloudinaryDeliveryUrl({
    url: mediaUrl,
    cloudName,
    resourceType: expectedResourceType,
    publicId: mediaPublicId,
    version: uploadVersion,
    format: mediaFormat,
  })) {
    throw new Error("Cloudinary returned an invalid delivery URL.");
  }

  return {
    mediaUrl,
    mediaPublicId,
    mediaResourceType: expectedResourceType,
    mediaFormat,
    mediaBytes,
    uploadVersion,
    uploadSignature,
  };
}

function withCloudinaryTransformation(url: string, resourceType: CloudinaryResourceType, transformation: string, format?: string) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "res.cloudinary.com") return url;
    const marker = `/${resourceType}/upload/`;
    if (!parsed.pathname.includes(marker)) return url;
    parsed.pathname = parsed.pathname.replace(marker, `${marker}${transformation}/`);
    if (format) parsed.pathname = parsed.pathname.replace(/\.[^./]+$/, `.${format}`);
    return parsed.toString();
  } catch {
    return url;
  }
}

export function cloudinaryImageDisplayUrl(url: string) {
  return withCloudinaryTransformation(url, "image", "f_auto,q_auto,c_limit,w_1600,h_1600");
}

export function cloudinaryAudioFallbackUrl(url: string) {
  if (/\.mp3(?:$|\?)/i.test(url)) return url;
  return withCloudinaryTransformation(url, "video", "f_mp3", "mp3");
}
