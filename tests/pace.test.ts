import { describe, expect, it } from 'vitest';
import { pace } from '../src/engine/pace';

describe('pace', () => {
  it('is null without a live value', () => {
    expect(pace(null, 100, 90, 'up')).toBeNull();
  });
  it('is peak within 5 WPM of the peak, above it, or before a peak exists', () => {
    expect(pace(95, 100, 99, 'down')).toBe('peak');
    expect(pace(104, 100, 90, null)).toBe('peak');
    expect(pace(40, null, 20, null)).toBe('peak');
  });
  it('is up or down outside the band by trend', () => {
    expect(pace(80, 100, 75, 'down')).toBe('up');
    expect(pace(80, 100, 85, 'up')).toBe('down');
  });
  it('keeps the previous direction inside the dead band', () => {
    expect(pace(80, 100, 79.5, 'up')).toBe('up');
    expect(pace(80, 100, 80.5, 'down')).toBe('down');
  });
  it('defaults to down when leaving the peak band with no trend', () => {
    expect(pace(80, 100, 80, 'peak')).toBe('down');
    expect(pace(80, 100, null, null)).toBe('down');
  });
});
