import { describe, expect, it, vi } from 'vitest';
import { nextEmployeeId } from '../../src/utils/employeeId';

function makeFakeTx(sequence: number[]) {
  let call = 0;
  return {
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi.fn().mockImplementation(async () => {
      const lastSeq = sequence[call];
      call += 1;
      return lastSeq === undefined ? [] : [{ lastSeq }];
    }),
  };
}

describe('nextEmployeeId', () => {
  it('formats the first allocated sequence as EMP001', async () => {
    const tx = makeFakeTx([1]);
    const id = await nextEmployeeId(tx as any);
    expect(id).toBe('EMP001');
  });

  it('zero-pads to 3 digits and does not pad beyond 3 for larger sequences', async () => {
    const tx = makeFakeTx([7, 42, 999, 1000]);
    expect(await nextEmployeeId(tx as any)).toBe('EMP007');
    expect(await nextEmployeeId(tx as any)).toBe('EMP042');
    expect(await nextEmployeeId(tx as any)).toBe('EMP999');
    expect(await nextEmployeeId(tx as any)).toBe('EMP1000');
  });

  it('ensures the singleton counter row exists before incrementing', async () => {
    const tx = makeFakeTx([1]);
    await nextEmployeeId(tx as any);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('throws if the atomic update returns no row', async () => {
    const tx = makeFakeTx([]);
    await expect(nextEmployeeId(tx as any)).rejects.toThrow('Failed to allocate employee ID sequence');
  });
});
