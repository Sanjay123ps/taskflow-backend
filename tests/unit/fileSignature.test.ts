import { describe, expect, it } from 'vitest';
import { matchesDeclaredMimeType } from '../../src/utils/fileSignature';

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0]);
const PDF_HEADER = Buffer.from('%PDF-1.7\n...');
const WEBP_HEADER = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('WEBP'),
]);
const ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);
const HTML_PAYLOAD = Buffer.from('<html><script>alert(1)</script></html>');

describe('matchesDeclaredMimeType — Phase 6.10 upload spoofing guard', () => {
  it('accepts a genuine PNG for image/png', () => {
    expect(matchesDeclaredMimeType(PNG_HEADER, 'image/png')).toBe(true);
  });

  it('accepts a genuine JPEG for image/jpeg', () => {
    expect(matchesDeclaredMimeType(JPEG_HEADER, 'image/jpeg')).toBe(true);
  });

  it('accepts a genuine WEBP for image/webp', () => {
    expect(matchesDeclaredMimeType(WEBP_HEADER, 'image/webp')).toBe(true);
  });

  it('accepts a genuine PDF for application/pdf', () => {
    expect(matchesDeclaredMimeType(PDF_HEADER, 'application/pdf')).toBe(true);
  });

  it('accepts a ZIP-container file declared as docx', () => {
    expect(
      matchesDeclaredMimeType(
        ZIP_HEADER,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe(true);
  });

  it('rejects an HTML payload spoofed as image/png (the core spoofing scenario)', () => {
    expect(matchesDeclaredMimeType(HTML_PAYLOAD, 'image/png')).toBe(false);
  });

  it('rejects an HTML payload spoofed as application/pdf', () => {
    expect(matchesDeclaredMimeType(HTML_PAYLOAD, 'application/pdf')).toBe(false);
  });

  it('rejects a PNG spoofed as a JPEG', () => {
    expect(matchesDeclaredMimeType(PNG_HEADER, 'image/jpeg')).toBe(false);
  });

  it('rejects binary content with NUL bytes declared as text/plain', () => {
    const binary = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x89, 0x50, 0x4e, 0x47]);
    expect(matchesDeclaredMimeType(binary, 'text/plain')).toBe(false);
  });

  it('accepts genuine plain text for text/plain', () => {
    expect(matchesDeclaredMimeType(Buffer.from('Just a normal note.\nSecond line.'), 'text/plain')).toBe(true);
  });

  it('passes through an unrecognized declared MIME type rather than rejecting', () => {
    expect(matchesDeclaredMimeType(HTML_PAYLOAD, 'application/x-something-unlisted')).toBe(true);
  });
});
