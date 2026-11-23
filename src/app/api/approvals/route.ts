import { NextResponse, type NextRequest } from 'next/server';
import { getAddress, isAddress, toEventSelector, type Address } from 'viem';
import {
  PERMIT2_ADDRESS,
  PERMIT2_APPROVAL_EVENT,
  PERMIT2_PERMIT_EVENT,
} from '@/features/txray/approvals/permit2';
import { isSupportedTxRayChain } from '@/features/txray/chains/chains';
import {
  checkRateLimit,
  requestClientKey,
  scheduleExternalRequest,
} from '@/lib/server/requestGuard';
import { isRecord } from '@/lib/validation';
import {
  APPROVAL_SOURCES,
  isApprovalSource,
  isBlockNumber,
  parseApprovalIndexPayload,
  type ApprovalBlockRange,
  type ApprovalIndexPayload,
  type ApprovalPair,
  type ApprovalRangeCoverage,
} from '@/features/txray/approvals/approvalIndex';
import { splitApprovalLogs } from '@/features/txray/approvals/approvalEvents';
import { getSharedJson, setSharedJson } from '@/lib/server/sharedState';

const APPROVAL_TOPIC0 =
  '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';
const APPROVAL_FOR_ALL_TOPIC0 =
  '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31';
const PERMIT2_APPROVAL_TOPIC0 = toEventSelector(PERMIT2_APPROVAL_EVENT);
const PERMIT2_PERMIT_TOPIC0 = toEventSelector(PERMIT2_PERMIT_EVENT);
const EVENT_SOURCES = {
  erc20: { topic: APPROVAL_TOPIC0 },
  nft: { topic: APPROVAL_FOR_ALL_TOPIC0 },
  permit2Approval: { topic: PERMIT2_APPROVAL_TOPIC0, contract: PERMIT2_ADDRESS },
  permit2Permit: { topic: PERMIT2_PERMIT_TOPIC0, contract: PERMIT2_ADDRESS },
} satisfies Record<(typeof APPROVAL_SOURCES)[number], { topic: string; contract?: Address }>;

const ETHERSCAN_BASE = 'https://api.etherscan.io/v2/api';
const PAGE_SIZE = 1000;
const MAX_PAGES_PER_SOURCE = 10;
const UPSTREAM_TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 2_000;
const SHARED_CACHE_NAMESPACE = 'approval-scan-v3';
const SHARED_CACHE_TTL_SECONDS = 60;

interface EtherscanLog {
  address: string;
  topics: string[];
}

interface LogPageResult {
  logs: EtherscanLog[];
  ranges: ApprovalRangeCoverage[];
}

const responseCache = new Map<
  string,
  { expiresAt: number; value: ApprovalIndexPayload }
>();
const inFlight = new Map<string, Promise<ApprovalIndexPayload>>();

function cacheResponse(key: string, value: ApprovalIndexPayload): void {
  const now = Date.now();
  if (responseCache.size >= MAX_CACHE_ENTRIES) {
    for (const [cachedKey, cached] of responseCache) {
      if (cached.expiresAt <= now) responseCache.delete(cachedKey);
    }
  }
  while (responseCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    if (typeof oldestKey !== 'string') break;
    responseCache.delete(oldestKey);
  }
  responseCache.set(key, { expiresAt: now + CACHE_TTL_MS, value });
}

function readCachedResponse(key: string): ApprovalIndexPayload | undefined {
  const cached = responseCache.get(key);
  return cached && cached.expiresAt > Date.now() ? cached.value : undefined;
}

function topicToAddress(topic: string): Address {
  return getAddress(`0x${topic.slice(-40)}`);
}

function isEtherscanLog(value: unknown): value is EtherscanLog {
  if (!isRecord(value)) return false;
  const log = value;
  return (
    typeof log.address === 'string' &&
    isAddress(log.address) &&
    Array.isArray(log.topics) &&
    log.topics.every((topic) => typeof topic === 'string')
  );
}

function upstreamMessage(value: unknown): string {
  if (!isRecord(value)) return '';
  const json = value;
  if (typeof json.result === 'string') return json.result;
  return typeof json.message === 'string' ? json.message : '';
}

async function fetchEtherscan(url: URL): Promise<unknown> {
  const response = await scheduleExternalRequest(() =>
    fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    }),
  );
  if (!response.ok) throw new Error(`Etherscan HTTP ${response.status}`);

  return response.json();
}

async function fetchSnapshotBlock(chainId: number, apiKey: string): Promise<number> {
  const url = new URL(ETHERSCAN_BASE);
  url.searchParams.set('chainid', String(chainId));
  url.searchParams.set('module', 'proxy');
  url.searchParams.set('action', 'eth_blockNumber');
  url.searchParams.set('apikey', apiKey);
  const json = await fetchEtherscan(url);
  if (isRecord(json) && typeof json.result === 'string' && /^0x[0-9a-f]+$/i.test(json.result)) {
    const block = Number(json.result);
    if (isBlockNumber(block)) return block;
  }
  throw new Error('Etherscan 未返回有效的截止区块');
}

async function fetchLogPage(url: URL): Promise<EtherscanLog[]> {
  const json = await fetchEtherscan(url);
  if (isRecord(json)) {
    const result = json.result;
    if (Array.isArray(result) && json.status === '1') {
      if (!result.every(isEtherscanLog)) {
        throw new Error('Etherscan 返回了无效日志数据');
      }
      return result;
    }
    if (Array.isArray(result) && result.length === 0 && json.message === 'No records found') return [];
  }

  const message = upstreamMessage(json);
  if (/no records found/i.test(message)) return [];
  throw new Error(message || 'Etherscan 查询失败');
}

async function fetchAllLogs(
  chainId: number,
  range: ApprovalBlockRange,
  ownerTopic: string,
  apiKey: string,
): Promise<LogPageResult> {
  const logs: EtherscanLog[] = [];
  const source: { topic: string; contract?: Address } = EVENT_SOURCES[range.source];

  for (let page = 1; page <= MAX_PAGES_PER_SOURCE; page += 1) {
    const url = new URL(ETHERSCAN_BASE);
    url.searchParams.set('chainid', String(chainId));
    url.searchParams.set('module', 'logs');
    url.searchParams.set('action', 'getLogs');
    if (source.contract) url.searchParams.set('address', source.contract);
    url.searchParams.set('topic0', source.topic);
    url.searchParams.set('topic1', ownerTopic);
    url.searchParams.set('topic0_1_opr', 'and');
    url.searchParams.set('fromBlock', String(range.fromBlock));
    url.searchParams.set('toBlock', String(range.toBlock));
    url.searchParams.set('page', String(page));
    url.searchParams.set('offset', String(PAGE_SIZE));
    url.searchParams.set('apikey', apiKey);

    try {
      const pageLogs = await fetchLogPage(url);
      logs.push(...pageLogs);
      if (pageLogs.length < PAGE_SIZE) return { logs, ranges: [{ ...range, status: 'complete' }] };
    } catch {
      return { logs, ranges: [{ ...range, status: 'failed' }] };
    }
  }

  if (range.fromBlock === range.toBlock) {
    return { logs, ranges: [{ ...range, status: 'saturated' }] };
  }
  const middle = range.fromBlock + Math.floor((range.toBlock - range.fromBlock) / 2);
  return {
    logs,
    ranges: [
      { ...range, toBlock: middle, status: 'pending' },
      { ...range, fromBlock: middle + 1, status: 'pending' },
    ],
  };
}

function dedupeSpenderPairs(logs: EtherscanLog[]): ApprovalPair[] {
  const pairs = new Map<string, ApprovalPair>();
  for (const log of logs) {
    const spenderTopic = log.topics[2];
    if (!spenderTopic) continue;
    try {
      const token = getAddress(log.address);
      const spender = topicToAddress(spenderTopic);
      pairs.set(`${token.toLowerCase()}-${spender.toLowerCase()}`, { token, spender });
    } catch {
      // Ignore malformed individual logs, while retaining all valid results.
    }
  }
  return [...pairs.values()];
}

function dedupePermit2Pairs(logs: EtherscanLog[]): ApprovalPair[] {
  const pairs = new Map<string, ApprovalPair>();
  for (const log of logs) {
    const tokenTopic = log.topics[2];
    const spenderTopic = log.topics[3];
    if (!tokenTopic || !spenderTopic) continue;
    try {
      const token = topicToAddress(tokenTopic);
      const spender = topicToAddress(spenderTopic);
      pairs.set(`${token.toLowerCase()}-${spender.toLowerCase()}`, { token, spender });
    } catch {
      // Ignore malformed individual logs, while retaining all valid results.
    }
  }
  return [...pairs.values()];
}

async function scanApprovals(
  owner: string,
  chainId: number,
  apiKey: string,
  snapshotBlock: number,
  requested: ApprovalBlockRange[] = APPROVAL_SOURCES.map((source) => ({ source, fromBlock: 0, toBlock: snapshotBlock })),
): Promise<ApprovalIndexPayload> {
  const ownerTopic = `0x${owner.slice(2).toLowerCase().padStart(64, '0')}`;
  const logs: Record<ApprovalBlockRange['source'], EtherscanLog[]> = {
    erc20: [], nft: [], permit2Approval: [], permit2Permit: [],
  };
  const ranges: ApprovalRangeCoverage[] = [];

  // Sequential requests avoid bursting through Etherscan's per-key rate limit.
  for (const range of requested) {
    const result = await fetchAllLogs(chainId, range, ownerTopic, apiKey);
    logs[range.source] = result.logs;
    ranges.push(...result.ranges);
  }

  const truncatedSources = [...new Set(ranges
    .filter((range) => range.status === 'pending' || range.status === 'saturated')
    .map((range) => range.source))];
  const approvalEvents = splitApprovalLogs(logs.erc20);

  return {
    erc20: approvalEvents.erc20,
    nft: dedupeSpenderPairs(logs.nft),
    nftToken: approvalEvents.nftToken,
    permit2: dedupePermit2Pairs([
      ...logs.permit2Approval,
      ...logs.permit2Permit,
    ]),
    coverage: {
      status: ranges.every((range) => range.status === 'complete') ? 'complete' : 'partial',
      truncatedSources,
      maxRecordsPerSource: PAGE_SIZE * MAX_PAGES_PER_SOURCE,
      snapshotBlock,
      ranges,
    },
  };
}

function parseContinuation(params: URLSearchParams) {
  const rangeParam = params.get('range');
  const snapshotParam = params.get('snapshot');
  if (rangeParam === null && snapshotParam === null) return undefined;
  const [source, from, to, extra] = rangeParam?.split(':') ?? [];
  const snapshotBlock = parseBlockParam(snapshotParam);
  const fromBlock = parseBlockParam(from);
  const toBlock = parseBlockParam(to);
  if (extra !== undefined || !isApprovalSource(source) || snapshotBlock === undefined ||
    fromBlock === undefined || toBlock === undefined || fromBlock > toBlock || toBlock > snapshotBlock) return null;
  return { snapshotBlock, range: { source, fromBlock, toBlock } };
}

function parseBlockParam(value: string | null | undefined): number | undefined {
  if (!value || !/^\d{1,16}$/.test(value)) return undefined;
  const number = Number(value);
  return isBlockNumber(number) ? number : undefined;
}

async function scanAndCache(owner: string, chainId: number, apiKey: string, cacheKey: string) {
  const block = await fetchSnapshotBlock(chainId, apiKey);
  const value = await scanApprovals(owner, chainId, apiKey, block);
  if (value.coverage.status === 'complete') {
    cacheResponse(cacheKey, value);
    try {
      await setSharedJson(SHARED_CACHE_NAMESPACE, cacheKey, value, SHARED_CACHE_TTL_SECONDS);
    } catch (error) {
      console.warn('[approvals] shared cache write failed', {
        chainId,
        message: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }
  return value;
}

function getPendingScan(owner: string, chainId: number, apiKey: string, cacheKey: string) {
  const existing = inFlight.get(cacheKey);
  if (existing) return existing;

  const pending = scanAndCache(owner, chainId, apiKey, cacheKey).finally(() => {
    if (inFlight.get(cacheKey) === pending) inFlight.delete(cacheKey);
  });
  inFlight.set(cacheKey, pending);
  return pending;
}

function upstreamFailure(chainId: number, error: unknown, guardBackend: string) {
  const message = error instanceof Error ? error.message : '上游查询失败';
  console.error('[approvals] upstream scan failed', { chainId, message });
  return NextResponse.json(
    { error: { code: 'UPSTREAM_FAILED', message: '授权索引服务暂时不可用，请稍后重试' } },
    { status: 502, headers: { 'Cache-Control': 'no-store', 'X-TxRay-Guard': guardBackend } },
  );
}

export async function GET(request: NextRequest) {
  const rateLimit = await checkRateLimit(
    `approvals:${requestClientKey(request.headers)}`,
    8,
    60_000,
  );
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后重试' } },
      {
        status: 429,
        headers: {
          'Retry-After': String(rateLimit.retryAfterSeconds),
          'X-TxRay-Guard': rateLimit.backend,
        },
      },
    );
  }

  const ownerParam = request.nextUrl.searchParams.get('owner');
  const chainId = Number(request.nextUrl.searchParams.get('chainId') ?? '1');
  if (!isSupportedTxRayChain(chainId)) {
    return NextResponse.json(
      { error: { code: 'UNSUPPORTED_CHAIN', message: '暂不支持该链' } },
      { status: 400 },
    );
  }
  if (!ownerParam || !isAddress(ownerParam)) {
    return NextResponse.json(
      { error: { code: 'INVALID_ADDRESS', message: '无效地址' } },
      { status: 400 },
    );
  }

  const continuation = parseContinuation(request.nextUrl.searchParams);
  if (continuation === null) {
    return NextResponse.json(
      { error: { code: 'INVALID_SCAN_RANGE', message: '无效的授权续扫区块范围' } },
      { status: 400 },
    );
  }

  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: { code: 'CONFIG_MISSING', message: '服务端未配置 Etherscan API key' } },
      { status: 503 },
    );
  }

  const owner = getAddress(ownerParam);
  if (continuation) {
    try {
      const value = await scanApprovals(owner, chainId, apiKey, continuation.snapshotBlock, [continuation.range]);
      return NextResponse.json(value, {
        headers: { 'Cache-Control': 'no-store', 'X-TxRay-Guard': rateLimit.backend },
      });
    } catch (error) {
      return upstreamFailure(chainId, error, rateLimit.backend);
    }
  }
  const cacheKey = `${chainId}:${owner.toLowerCase()}`;
  const cached = readCachedResponse(cacheKey);
  if (cached) {
    return NextResponse.json(cached, {
      headers: {
        'Cache-Control': 'public, max-age=30, s-maxage=60',
        'X-TxRay-Cache': 'memory',
        'X-TxRay-Guard': rateLimit.backend,
      },
    });
  }

  let sharedCacheStatus = 'memory-only';
  try {
    const shared = await getSharedJson(SHARED_CACHE_NAMESPACE, cacheKey);
    if (shared.status === 'hit') {
      const cachedAfterSharedRead = readCachedResponse(cacheKey);
      const value = cachedAfterSharedRead ?? parseApprovalIndexPayload(shared.value);
      if (!cachedAfterSharedRead) cacheResponse(cacheKey, value);
      return NextResponse.json(value, {
        headers: {
          'Cache-Control': 'public, max-age=30, s-maxage=60',
          'X-TxRay-Cache': cachedAfterSharedRead ? 'memory' : 'shared',
          'X-TxRay-Guard': rateLimit.backend,
        },
      });
    }
    if (shared.status === 'miss') sharedCacheStatus = 'shared-miss';
  } catch (error) {
    sharedCacheStatus = 'degraded';
    console.warn('[approvals] shared cache read failed', {
      chainId,
      message: error instanceof Error ? error.message : 'unknown error',
    });
  }

  try {
    const cachedAfterSharedRead = readCachedResponse(cacheKey);
    if (cachedAfterSharedRead) sharedCacheStatus = 'memory';
    const value = cachedAfterSharedRead ?? await getPendingScan(owner, chainId, apiKey, cacheKey);
    if (value.coverage.status === 'partial') {
      return NextResponse.json(value, {
        headers: { 'Cache-Control': 'no-store', 'X-TxRay-Cache': sharedCacheStatus, 'X-TxRay-Guard': rateLimit.backend },
      });
    }
    return NextResponse.json(value, {
      headers: {
        'Cache-Control': 'public, max-age=30, s-maxage=60',
        'X-TxRay-Cache': sharedCacheStatus,
        'X-TxRay-Guard': rateLimit.backend,
      },
    });
  } catch (error) {
    return upstreamFailure(chainId, error, rateLimit.backend);
  }
}
