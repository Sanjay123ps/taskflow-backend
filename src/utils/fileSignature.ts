/**
 * Phase 6.10/Phase 5 hardening: `upload.middleware.ts`'s fileFilter only
 * checks the MIME type the *client* declared in the multipart request —
 * that's just a string the caller sets and is trivially spoofable (e.g.
 * naming a `.html`/`.svg` payload `photo.png` with
 * `Content-Type: image/png`). Multer's fileFilter also runs before the
 * buffer is fully available on memoryStorage, so content sniffing has to
 * happen as a separate step once `req.file.buffer` exists — see
 * `validateFileSignature` in upload.middleware.ts, which calls this after
 * multer has finished buffering the upload.
 *
 * This is a lightweight, dependency-free signature check (no `file-type`
 * package in this project's dependencies) covering exactly the MIME types
 * ALLOWED_ATTACHMENT_MIME_TYPES / ALLOWED_IMAGE_MIME_TYPES accept today.
 * It is not a full-fidelity file-type sniffer — it only needs to answer
 * "does this buffer's header match what the declared MIME type implies",
 * which is enough to catch spoofed uploads without pulling in a new
 * dependency for a handful of well-known magic numbers.
 */

function matchesBytes(buffer: Buffer, offset: number, bytes: number[]): boolean {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, i) => buffer[offset + i] === byte);
}

// ZIP-based Office formats (docx/xlsx) and PDFs are validated by their
// container signature only — we don't parse the ZIP central directory or
// PDF structure, since that's out of scope for a spoofing check.
const ZIP_SIGNATURES = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06], // empty archive
  [0x50, 0x4b, 0x07, 0x08], // spanned archive
];

function isPlausibleText(buffer: Buffer): boolean {
  // Reject content that isn't plausibly plain text: a NUL byte or a
  // suspiciously high proportion of other control bytes strongly suggests
  // a mislabeled binary file rather than genuine text.
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  let controlBytes = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) controlBytes += 1;
  }
  return controlBytes / Math.max(sample.length, 1) < 0.05;
}

const SIGNATURE_CHECKS: Record<string, (buffer: Buffer) => boolean> = {
  'image/png': (buf) => matchesBytes(buf, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': (buf) => matchesBytes(buf, 0, [0xff, 0xd8, 0xff]),
  'image/webp': (buf) => matchesBytes(buf, 0, [0x52, 0x49, 0x46, 0x46]) && matchesBytes(buf, 8, [0x57, 0x45, 0x42, 0x50]),
  'application/pdf': (buf) => matchesBytes(buf, 0, [0x25, 0x50, 0x44, 0x46]), // "%PDF"
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': (buf) =>
    ZIP_SIGNATURES.some((sig) => matchesBytes(buf, 0, sig)),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': (buf) =>
    ZIP_SIGNATURES.some((sig) => matchesBytes(buf, 0, sig)),
  // Legacy OLE Compound File format (.doc, .xls).
  'application/msword': (buf) => matchesBytes(buf, 0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  'application/vnd.ms-excel': (buf) => matchesBytes(buf, 0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  'text/plain': isPlausibleText,
};

/**
 * Returns true if the buffer's content plausibly matches the declared MIME
 * type. Unknown MIME types (shouldn't happen — upload.middleware.ts's
 * fileFilter already restricts to the allow-lists above) pass through,
 * since this function's job is to catch spoofing within the allowed set,
 * not to be a general-purpose type detector.
 */
export function matchesDeclaredMimeType(buffer: Buffer, declaredMimeType: string): boolean {
  const check = SIGNATURE_CHECKS[declaredMimeType];
  if (!check) return true;
  return check(buffer);
}
