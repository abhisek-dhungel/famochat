import { createHash, timingSafeEqual } from "node:crypto";

export function signCloudinaryParameters(parameters: Record<string, string | number>, apiSecret: string) {
  const serialized = Object.entries(parameters)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return createHash("sha1").update(`${serialized}${apiSecret}`).digest("hex");
}

export function verifyCloudinaryUploadSignature({
  publicId,
  version,
  signature,
  apiSecret,
}: {
  publicId: string;
  version: number;
  signature: string;
  apiSecret: string;
}) {
  const expected = signCloudinaryParameters({ public_id: publicId, version }, apiSecret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
