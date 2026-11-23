import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPublicClient, custom, getAddress } from 'viem';
import {
  classifySpenderRisk,
  fetchSpenderRisk,
  parseSpenderInfoPayload,
} from './useSpenderRisk';

const NOW = 1_800_000_000;

afterEach(() => vi.unstubAllGlobals());

it('tracks threat coverage per batch and distinguishes empty code from RPC failure', async () => {
  const addresses = Array.from({ length: 26 }, (_, index) => getAddress(`0x${(index + 1).toString(16).padStart(40, '0')}`));
  const [noCode, malicious] = addresses;
  const last = addresses[25];
  const client = createPublicClient({ transport: custom({
    async request({ params }) {
      const address = Array.isArray(params) ? params[0] : undefined;
      if (address === noCode) return '0x';
      if (typeof address === 'string' && address.toLowerCase() === last.toLowerCase()) throw new Error('RPC unavailable');
      return '0x6000';
    },
  }, { retryCount: 0 }) });
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json({ created: {}, threat: {
      status: 'available', malicious: [malicious], checkedAt: NOW * 1000,
      source: { name: 'Scam Sniffer', repositoryUrl: 'https://github.com/scamsniffer/scam-database', publicDelayDays: 7 },
    } }))
    .mockResolvedValueOnce(new Response(null, { status: 503 }));
  vi.stubGlobal('fetch', fetchMock);

  const result = await fetchSpenderRisk(client, addresses, 1);
  expect(Object.values(result).filter((risk) => risk.threat.status === 'available')).toHaveLength(25);
  expect(result[noCode.toLowerCase()]).toMatchObject({ level: 'eoa', codeVerified: true });
  expect(result[malicious.toLowerCase()].level).toBe('malicious');
  expect(result[last.toLowerCase()]).toMatchObject({ level: 'unknown', codeVerified: false, threat: { status: 'unavailable' } });
});

describe('classifySpenderRisk', () => {
  it('flags EOA spenders as high-risk even if they are otherwise unknown', () => {
    const result = classifySpenderRisk({
      address: '0xFb3C2B2769A2119f349233A44A640F090C907667',
      isEoa: true,
      now: NOW,
    });

    expect(result.level).toBe('eoa');
    expect(result.codeVerified).toBe(true);
    expect(result.reason).toContain('普通钱包');
  });

  it('prioritizes attributable threat intelligence over other heuristics', () => {
    const result = classifySpenderRisk({
      address: '0xFb3C2B2769A2119f349233A44A640F090C907667',
      isEoa: false,
      malicious: true,
      threat: {
        status: 'available',
        sourceName: 'Scam Sniffer',
        sourceUrl: 'https://github.com/scamsniffer/scam-database',
        publicDelayDays: 7,
        checkedAt: NOW * 1000,
      },
      now: NOW,
    });

    expect(result.level).toBe('malicious');
    expect(result.threat.sourceName).toBe('Scam Sniffer');
  });

  it('marks trusted known contracts as known', () => {
    const result = classifySpenderRisk({
      address: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      isEoa: false,
      now: NOW,
    });

    expect(result.level).toBe('known');
    expect(result.labelName).toBe('Uniswap V3 Router');
  });

  it('marks recently deployed unknown contracts as new', () => {
    const result = classifySpenderRisk({
      address: '0x2222222222222222222222222222222222222222',
      isEoa: false,
      createdAt: NOW - 3 * 86400,
      now: NOW,
    });

    expect(result.level).toBe('new');
    expect(result.reason).toContain('3 天前部署');
  });

  it('does not classify an RPC failure as an EOA', () => {
    const result = classifySpenderRisk({
      address: '0x2222222222222222222222222222222222222222',
      isEoa: undefined,
      now: NOW,
    });

    expect(result.level).toBe('unknown');
    expect(result.codeVerified).toBe(false);
    expect(result.reason).toContain('RPC');
  });
});

describe('parseSpenderInfoPayload', () => {
  it('keeps only safe timestamps and normalizes keys', () => {
    expect(
      parseSpenderInfoPayload({
        created: {
          '0xABC': 1_700_000_000,
          '0xDEF': null,
          bad: Number.NaN,
          negative: -1,
        },
      }),
    ).toMatchObject({
      created: { '0xabc': 1_700_000_000, '0xdef': null },
      threat: { status: 'unavailable' },
    });
  });

  it('parses malicious matches and source freshness separately from contract age', () => {
    const result = parseSpenderInfoPayload({
      created: {},
      threat: {
        status: 'available',
        malicious: ['0xFb3C2B2769A2119f349233A44A640F090C907667'],
        checkedAt: 1_800_000_000_000,
        stale: false,
        source: {
          name: 'Scam Sniffer',
          repositoryUrl: 'https://github.com/scamsniffer/scam-database',
          publicDelayDays: 7,
        },
      },
    });

    expect([...result.malicious]).toEqual([
      '0xfb3c2b2769a2119f349233a44a640f090c907667',
    ]);
    expect(result.threat).toMatchObject({
      status: 'available',
      checkedAt: 1_800_000_000_000,
    });
  });
});
