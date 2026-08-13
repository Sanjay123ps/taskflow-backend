import { describe, expect, it, vi, beforeEach } from 'vitest';

const { createSignedUrl, warnLog } = vi.hoisted(() => ({
  createSignedUrl: vi.fn(),
  warnLog: vi.fn(),
}));

vi.mock('../../src/config/supabase', () => ({
  supabaseAdmin: {
    storage: {
      from: vi.fn(() => ({ createSignedUrl })),
    },
  },
}));

vi.mock('../../src/config/logger', () => ({
  logger: { warn: warnLog, error: vi.fn(), info: vi.fn() },
}));

import { createSignedAttachmentUrl } from '../../src/utils/storage';

describe('createSignedAttachmentUrl — Phase 5 (private bucket + signed URLs)', () => {
  beforeEach(() => {
    createSignedUrl.mockReset();
    warnLog.mockReset();
  });

  it('returns null without calling Supabase when path is null/undefined', async () => {
    expect(await createSignedAttachmentUrl(null)).toBeNull();
    expect(await createSignedAttachmentUrl(undefined)).toBeNull();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('returns the signed URL on success', async () => {
    createSignedUrl.mockResolvedValueOnce({ data: { signedUrl: 'https://signed.example/task.pdf?token=abc' }, error: null });
    const url = await createSignedAttachmentUrl('tasks/some-uuid.pdf');
    expect(url).toBe('https://signed.example/task.pdf?token=abc');
  });

  it('requests a short (5 minute) expiry, not a long-lived one', async () => {
    createSignedUrl.mockResolvedValueOnce({ data: { signedUrl: 'https://signed.example/x' }, error: null });
    await createSignedAttachmentUrl('tasks/some-uuid.pdf');
    expect(createSignedUrl).toHaveBeenCalledWith('tasks/some-uuid.pdf', 5 * 60);
  });

  it('degrades to null (not a thrown error) when Supabase Storage errors', async () => {
    createSignedUrl.mockResolvedValueOnce({ data: null, error: { message: 'object not found' } });
    const url = await createSignedAttachmentUrl('tasks/missing.pdf');
    expect(url).toBeNull();
    expect(warnLog).toHaveBeenCalled();
  });
});
