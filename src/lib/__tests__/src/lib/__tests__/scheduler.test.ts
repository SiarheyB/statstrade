import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Top-level mock for the dynamically imported sync module
vi.mock('@/lib/sync', () => ({
  runDueSyncs: vi.fn(),
}));

describe('scheduler', () => {
  let startScheduler: () => Promise<void>;
  let mockedRunDueSyncs: ReturnType<typeof vi.fn>;
  let setTimeoutSpy: ReturnType<typeof vi.spyOn>;
  let setIntervalSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules(); // reset module-level `started` flag between tests
    vi.useFakeTimers();

    const schedulerMod = await import('@/lib/scheduler');
    startScheduler = schedulerMod.startScheduler;
    const syncMod = await import('@/lib/sync');
    mockedRunDueSyncs = vi.mocked(syncMod.runDueSyncs);

    mockedRunDueSyncs.mockReset();
    mockedRunDueSyncs.mockResolvedValue({ advanced: [], failed: [], due: 0 });

    // Wrap the (already faked) timer globals so we can assert on their calls.
    setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does nothing if already started', async () => {
    await startScheduler();
    await startScheduler(); // second call should be no-op

    // Only the first call registers timers.
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it('registers setTimeout for initial tick', async () => {
    await startScheduler();
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 10_000);
  });

  it('registers setInterval for recurring ticks', async () => {
    await startScheduler();
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
  });

  it('executes tick function and calls sync module', async () => {
    mockedRunDueSyncs.mockResolvedValueOnce({
      advanced: [{ accountId: 'acc1' }],
      failed: [{ accountId: 'acc2', error: 'timeout' }],
      due: 5,
    });

    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await startScheduler();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(mockedRunDueSyncs).toHaveBeenCalled();
    // runDueSyncs() is called with no args; the scheduler logs the result.
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '[scheduler] advanced=1 failed=1 due=5',
    );

    consoleLogSpy.mockRestore();
  });

  it('handles errors in tick gracefully', async () => {
    mockedRunDueSyncs.mockRejectedValueOnce(new Error('DB connection failed'));

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await startScheduler();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[scheduler] tick error:',
      'DB connection failed',
    );

    consoleErrorSpy.mockRestore();
  });

  it('continues scheduling after tick error', async () => {
    let callCount = 0;
    mockedRunDueSyncs.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error('First tick fails');
      return { advanced: [], failed: [], due: 0 };
    });

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await startScheduler();

    // First tick fails
    await vi.advanceTimersByTimeAsync(10_000);
    expect(consoleErrorSpy).toHaveBeenCalled();

    // Second tick succeeds
    await vi.advanceTimersByTimeAsync(60_000);
    expect(callCount).toBe(2);

    consoleErrorSpy.mockRestore();
  });
});
