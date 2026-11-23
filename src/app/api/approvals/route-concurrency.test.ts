import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getSharedJson, setSharedJson } from '@/lib/server/sharedState';
import { GET } from './route';

vi.mock('@/lib/server/sharedState', () => ({ getSharedJson: vi.fn(), setSharedJson: vi.fn() }));
vi.mock('@/lib/server/requestGuard', () => ({
  checkRateLimit: async () => ({ allowed: true, backend: 'shared' }),
  requestClientKey: () => 'approvals-concurrency',
  scheduleExternalRequest: <T,>(callback: () => Promise<T>) => callback(),
}));

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function request(owner: string) {
  return new NextRequest(`http://localhost/api/approvals?owner=${owner}&chainId=1`);
}

function successfulScan(input: RequestInfo | URL) {
  const params = new URL(String(input)).searchParams;
  return params.get('action') === 'eth_blockNumber'
    ? Response.json({ result: '0x20' })
    : Response.json({ status: '1', result: [] });
}

describe('approval scan coordination', () => {
  it('shares the cache write and rechecks memory after a delayed Redis miss', async () => {
    vi.stubEnv('ETHERSCAN_API_KEY', 'test-key');
    const req = request('0x0000000000000000000000000000000000000101');
    const delayedRead = deferred<{ status: 'miss' }>();
    const delayedWrite = deferred<boolean>();
    vi.mocked(getSharedJson)
      .mockResolvedValueOnce({ status: 'miss' })
      .mockResolvedValueOnce({ status: 'miss' })
      .mockReturnValueOnce(delayedRead.promise);
    vi.mocked(setSharedJson).mockResolvedValue(true).mockReturnValueOnce(delayedWrite.promise);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => successfulScan(input));
    vi.stubGlobal('fetch', fetchMock);

    const requests = [GET(req), GET(req), GET(req)];
    try {
      await vi.waitFor(() => expect(setSharedJson).toHaveBeenCalled());
      delayedRead.resolve({ status: 'miss' });
      expect((await requests[2]).headers.get('X-TxRay-Cache')).toBe('memory');
      expect(setSharedJson).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(5);
    } finally {
      delayedRead.resolve({ status: 'miss' });
      delayedWrite.resolve(true);
      await Promise.all(requests);
    }
  });

  it('allows a fresh scan after an upstream rejection', async () => {
    vi.stubEnv('ETHERSCAN_API_KEY', 'test-key');
    const req = request('0x0000000000000000000000000000000000000102');
    vi.mocked(getSharedJson).mockResolvedValue({ status: 'miss' });
    vi.mocked(setSharedJson).mockResolvedValue(true);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => successfulScan(input))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    const failed = await GET(req);
    expect(failed.status).toBe(502);
    expect(failed.headers.get('Cache-Control')).toBe('no-store');
    const retried = await GET(req);
    expect(retried.status).toBe(200);
    await expect(retried.json()).resolves.toMatchObject({ coverage: { status: 'complete' } });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
