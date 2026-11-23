import { describe, expect, it } from 'vitest';
import { EIP7702_PREFIX, parseAccountCode } from './eip7702';

describe('parseAccountCode (EIP-7702)', () => {
  it('treats undefined or 0x bytecode as a plain EOA', () => {
    expect(parseAccountCode(undefined)).toEqual({ status: 'eoa' });
    expect(parseAccountCode('0x')).toEqual({ status: 'eoa' });
  });

  it('extracts and checksums the 20-byte delegate address from 0xef0100 designator code', () => {
    const rawDelegate = 'e592427a0aece92de3edee1f18e0157c05861564';
    expect(parseAccountCode(`${EIP7702_PREFIX}${rawDelegate}`)).toEqual({
      status: 'delegated',
      delegate: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    });
    expect(parseAccountCode(`0xEF0100${rawDelegate.toUpperCase()}`)).toEqual({
      status: 'delegated',
      delegate: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    });
  });

  it('does not misclassify ordinary contract bytecode or wrong-length 0xef0100 code as delegated', () => {
    expect(parseAccountCode('0x6080604052')).toEqual({
      status: 'contract',
      byteLength: 5,
    });
    expect(parseAccountCode(`${EIP7702_PREFIX}e592427a0aece92de3edee1f18e0157c0586156400`)).toEqual({
      status: 'contract',
      byteLength: 24,
    });
  });

  it('marks malformed or odd-length responses as unavailable', () => {
    expect(parseAccountCode('not-hex')).toEqual({ status: 'unavailable' });
    expect(parseAccountCode('0x123')).toEqual({ status: 'unavailable' });
  });
});
