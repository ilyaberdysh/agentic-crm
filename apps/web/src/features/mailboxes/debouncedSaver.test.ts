import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DebouncedSaver } from './debouncedSaver';

describe('DebouncedSaver', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('saves only the latest value once the delay passed without a newer one', async () => {
    const save = vi.fn();
    const saver = new DebouncedSaver<string>(save, 600);
    saver.schedule('a');
    await vi.advanceTimersByTimeAsync(400);
    saver.schedule('ab');
    await vi.advanceTimersByTimeAsync(400);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('ab');
    expect(saver.hasPending).toBe(false);
  });

  it('flush saves a pending value at once and only once', async () => {
    const save = vi.fn();
    const saver = new DebouncedSaver<number>(save, 600);
    saver.schedule(1);
    expect(saver.hasPending).toBe(true);
    await saver.flush();
    await saver.flush();
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(1);
  });

  it('cancel drops the pending value', async () => {
    const save = vi.fn();
    const saver = new DebouncedSaver<number>(save, 100);
    saver.schedule(1);
    saver.cancel();
    await vi.advanceTimersByTimeAsync(500);
    await saver.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it('uses the latest save function', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const saver = new DebouncedSaver<string>(first, 100);
    saver.schedule('x');
    saver.setSave(second);
    await vi.advanceTimersByTimeAsync(150);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('x');
  });
});
