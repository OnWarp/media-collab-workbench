import { describe, it, expect } from 'vitest';
import { looseUrl, fmtTime, fmtMoney, stageOrder } from '../api';
import type { Topic } from '../types';

describe('looseUrl', () => {
  it('should return true for valid http URLs', () => {
    expect(looseUrl('http://example.com')).toBe(true);
    expect(looseUrl('https://example.com/path?query=1')).toBe(true);
  });

  it('should return false for invalid URLs', () => {
    expect(looseUrl('')).toBe(false);
    expect(looseUrl('not-a-url')).toBe(false);
    expect(looseUrl('ftp://example.com')).toBe(false);
    expect(looseUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('fmtTime', () => {
  it('should format timestamp correctly', () => {
    const ts = new Date('2026-01-15T10:30:00').getTime();
    const result = fmtTime(ts);
    expect(result).toMatch(/1-15 10:30/);
  });

  it('should return empty string for null/undefined', () => {
    expect(fmtTime(null)).toBe('');
    expect(fmtTime(undefined)).toBe('');
  });
});

describe('fmtMoney', () => {
  it('should format money correctly', () => {
    expect(fmtMoney(40)).toBe('¥40.00');
    expect(fmtMoney(15.5)).toBe('¥15.50');
  });

  it('should handle null/undefined', () => {
    expect(fmtMoney(null)).toBe('¥0.00');
    expect(fmtMoney(undefined)).toBe('¥0.00');
  });
});

describe('stageOrder', () => {
  it('should return full stages for full work type', () => {
    const topic = { workType: 'full' } as Topic;
    expect(stageOrder(topic)).toEqual(['confirm', 'copywriting', 'video', 'done']);
  });

  it('should return copy stages for copywriting work type', () => {
    const topic = { workType: 'copywriting' } as Topic;
    expect(stageOrder(topic)).toEqual(['confirm', 'copywriting', 'done']);
  });
});
