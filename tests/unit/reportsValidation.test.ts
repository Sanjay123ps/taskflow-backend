import { describe, expect, it } from 'vitest';
import { reportQuerySchema, reportTypeParamSchema } from '../../src/modules/reports/reports.validation';

describe('reportTypeParamSchema', () => {
  it('accepts each supported report type', () => {
    for (const type of ['tasks', 'staff', 'activity', 'attendance']) {
      expect(reportTypeParamSchema.parse({ type }).type).toBe(type);
    }
  });

  it('rejects an unknown report type', () => {
    expect(() => reportTypeParamSchema.parse({ type: 'invoices' })).toThrow();
  });
});

describe('reportQuerySchema — date range hardening (Phase 4)', () => {
  it('defaults format to xlsx and allows no date filter at all', () => {
    const result = reportQuerySchema.parse({});
    expect(result.format).toBe('xlsx');
  });

  it('accepts a range within the 366-day cap', () => {
    const result = reportQuerySchema.parse({ dateFrom: '2026-01-01', dateTo: '2026-06-01' });
    expect(result.dateFrom).toBe('2026-01-01');
    expect(result.dateTo).toBe('2026-06-01');
  });

  it('accepts a range exactly at the 366-day cap', () => {
    // 2026-01-01 -> 2027-01-02 is exactly 366 days.
    expect(() => reportQuerySchema.parse({ dateFrom: '2026-01-01', dateTo: '2027-01-02' })).not.toThrow();
  });

  it('rejects a range wider than 366 days', () => {
    expect(() => reportQuerySchema.parse({ dateFrom: '2020-01-01', dateTo: '2026-01-01' })).toThrow(
      /Date range cannot exceed 366 days/,
    );
  });

  it('rejects dateTo before dateFrom', () => {
    expect(() => reportQuerySchema.parse({ dateFrom: '2026-06-01', dateTo: '2026-01-01' })).toThrow(
      /dateTo must not be before dateFrom/,
    );
  });

  it('does not require both bounds — an open-ended range is left to the row cap, not rejected here', () => {
    expect(() => reportQuerySchema.parse({ dateFrom: '2015-01-01' })).not.toThrow();
    expect(() => reportQuerySchema.parse({ dateTo: '2026-01-01' })).not.toThrow();
  });

  it('rejects an unsupported format value', () => {
    expect(() => reportQuerySchema.parse({ format: 'pdf' })).toThrow();
  });
});
