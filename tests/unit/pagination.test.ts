import { describe, expect, it } from 'vitest';
import { buildPaginatedResult, normalizePagination } from '../../src/utils/pagination';

describe('normalizePagination', () => {
  it('defaults to page 1, pageSize 20', () => {
    const result = normalizePagination({});
    expect(result).toEqual({ page: 1, pageSize: 20, skip: 0, take: 20 });
  });

  it('computes skip/take for a later page', () => {
    const result = normalizePagination({ page: 3, pageSize: 10 });
    expect(result).toEqual({ page: 3, pageSize: 10, skip: 20, take: 10 });
  });

  it('clamps pageSize to the maximum of 100', () => {
    const result = normalizePagination({ pageSize: 5000 });
    expect(result.pageSize).toBe(100);
  });

  it('clamps page to a minimum of 1 for zero/negative input', () => {
    expect(normalizePagination({ page: 0 }).page).toBe(1);
    expect(normalizePagination({ page: -5 }).page).toBe(1);
  });

  it('falls back to defaults for non-numeric input', () => {
    const result = normalizePagination({ page: 'abc' as unknown as number });
    expect(result.page).toBe(1);
  });
});

describe('buildPaginatedResult', () => {
  it('computes totalPages correctly, rounding up', () => {
    const pagination = normalizePagination({ page: 1, pageSize: 10 });
    const result = buildPaginatedResult(['a', 'b'], 25, pagination);
    expect(result).toEqual({ items: ['a', 'b'], total: 25, page: 1, pageSize: 10, totalPages: 3 });
  });

  it('reports at least 1 total page even when total is 0', () => {
    const pagination = normalizePagination({ page: 1, pageSize: 10 });
    const result = buildPaginatedResult([], 0, pagination);
    expect(result.totalPages).toBe(1);
  });
});
