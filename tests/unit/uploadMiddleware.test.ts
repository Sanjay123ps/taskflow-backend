import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { validateFileSignature } from '../../src/middleware/upload.middleware';
import { BadRequestError } from '../../src/utils/errors';

function makeReq(file?: Partial<Express.Multer.File>): Request {
  return { file } as unknown as Request;
}

describe('validateFileSignature middleware (Phase 6.10)', () => {
  it('calls next() with no args when there is no file (nothing to validate)', () => {
    const next = vi.fn();
    validateFileSignature(makeReq(undefined), {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next() with no args when the buffer matches the declared MIME type', () => {
    const next = vi.fn();
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    validateFileSignature(makeReq({ mimetype: 'image/png', buffer: pngBuffer }), {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next(BadRequestError) when the buffer does not match the declared MIME type', () => {
    const next = vi.fn();
    const htmlBuffer = Buffer.from('<html><script>alert(1)</script></html>');
    validateFileSignature(makeReq({ mimetype: 'image/png', buffer: htmlBuffer }), {} as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(BadRequestError);
    expect(err.message).toMatch(/doesn't match its declared type/);
  });
});
