import { describe, expect, it, vi } from 'vitest';
import { encodeFunctionData, parseAbi, parseAbiItem, type PublicClient } from 'viem';
import { buildCallTree } from './call-tree/decode';
import { NESTED_MULTICALL_EXAMPLE } from './examples';
import { encodeSafeExecTransaction } from './call-tree/fixtures';
import { decodeCalldata, decodeInput, isMaxUintValue } from './useDecoder';
import { parseVerifiedFunctions } from './verifiedAbi';

const APPROVE_MAX =
  '0x095ea7b3000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

describe('decodeInput', () => {
  it('decodes known calldata locally without a network lookup', async () => {
    const lookup = vi.fn();
    const result = await decodeInput(undefined, APPROVE_MAX, lookup);

    expect(result.functionName).toBe('approve');
    expect(result.params).toHaveLength(2);
    expect(result.params[1].approvalAmountScope).toBe('max');
    expect(result.params[0].value.toLowerCase()).toBe(
      '0xe592427a0aece92de3edee1f18e0157c05861564',
    );
    expect(result.danger).toBe('high');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects malformed calldata', async () => {
    await expect(decodeInput(undefined, '0x1234')).rejects.toThrow(
      '不是有效的 calldata',
    );
  });

  it('does not call a revocation an NFT-wide grant', async () => {
    const data = encodeFunctionData({
      abi: [parseAbiItem('function setApprovalForAll(address operator, bool approved)')],
      args: ['0xE592427A0AEce92De3Edee1F18E0157C05861564', false],
    });
    const result = await decodeInput(undefined, data, vi.fn(), 'calldata');
    expect(result.danger).toBe('none');
    expect(result.explainKey).toBe('approvalForAllRevoked');
  });

  it('keeps approve(address, 0) ambiguous without the target contract type', async () => {
    const data = encodeFunctionData({
      abi: [parseAbiItem('function approve(address spender, uint256 value)')],
      args: ['0xE592427A0AEce92De3Edee1F18E0157C05861564', 0n],
    });
    const result = await decodeInput(undefined, data, vi.fn(), 'calldata');
    expect(result.danger).toBe('medium');
    expect(result.explainKey).toBe('approveZeroAmbiguous');
  });

  it('does not label an ordinary approve call high-risk without target ABI', async () => {
    const data = encodeFunctionData({
      abi: [parseAbiItem('function approve(address spender, uint256 value)')],
      args: ['0xE592427A0AEce92De3Edee1F18E0157C05861564', 25n],
    });
    expect((await decodeInput(undefined, data, vi.fn(), 'calldata')).danger).toBe('medium');
  });

  it('does not present a selector-only candidate as a decoded function', async () => {
    const result = await decodeInput(undefined, '0x095ea7b3', vi.fn(), 'calldata');
    expect(result.functionName).toBeNull();
    expect(result.explainKey).toBeUndefined();
  });

  it('keeps 32-byte calldata as calldata when the mode is explicit', async () => {
    const bytes = `0x095ea7b3${'0'.repeat(56)}`;
    const client = { getTransaction: vi.fn() } as unknown as PublicClient;
    const result = await decodeInput(client, bytes, vi.fn(), 'calldata');
    expect(result.source).toBe('calldata');
    expect(client.getTransaction).not.toHaveBeenCalled();
  });

  it('does not interpret incomplete hashes as calldata in transaction mode', async () => {
    await expect(decodeInput(undefined, '0x095ea7b3', vi.fn(), 'tx'))
      .rejects.toThrow('不是有效的交易哈希');
  });

  it('resolves tx hash input and carries the transaction value', async () => {
    const lookup = vi.fn();
    const client = {
      getTransaction: vi.fn().mockResolvedValue({
        input: APPROVE_MAX,
        to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        value: 123n,
      }),
    } as unknown as PublicClient;

    const hash =
      '0x1111111111111111111111111111111111111111111111111111111111111111';
    const result = await decodeInput(client, hash, lookup);

    expect(result.source).toBe('tx');
    expect(result.functionName).toBe('approve');
    expect(result.to).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
    expect(result.txValue).toBe(123n);
    expect(client.getTransaction).toHaveBeenCalledWith({ hash });
  });

  it('rejects plain transfers without calldata', async () => {
    const client = {
      getTransaction: vi.fn().mockResolvedValue({ input: '0x', to: null }),
    } as unknown as PublicClient;
    const hash =
      '0x2222222222222222222222222222222222222222222222222222222222222222';
    await expect(decodeInput(client, hash, vi.fn())).rejects.toThrow(
      '没有可解码的 calldata',
    );
  });
});

describe('isMaxUintValue', () => {
  it('supports declared integer widths', () => {
    expect(isMaxUintValue('uint160', (2n ** 160n - 1n).toString())).toBe(true);
    expect(isMaxUintValue('uint256', (2n ** 256n - 1n).toString())).toBe(true);
    expect(isMaxUintValue('uint160', (2n ** 256n - 1n).toString())).toBe(false);
  });
});

describe('verified target ABI', () => {
  const target = '0x0000000000000000000000000000000000000001';
  const spender = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
  const erc721 = parseAbi([
    'function approve(address approved, uint256 nftId)',
    'function ownerOf(uint256) view returns (address)',
    'function getApproved(uint256) view returns (address)',
    'function isApprovedForAll(address,address) view returns (bool)',
    'function supportsInterface(bytes4) view returns (bool)',
  ]);
  const erc20 = parseAbi([
    'function approve(address spender, uint256 allowanceValue) returns (bool)',
    'function allowance(address,address) view returns (uint256)',
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address,uint256) returns (bool)',
    'function transferFrom(address,address,uint256) returns (bool)',
  ]);

  it('uses actual ABI parameter names and distinguishes NFT token zero from clearing a fungible allowance', async () => {
    const calldata = encodeFunctionData({ abi: erc721, functionName: 'approve', args: [spender, 0n] });
    const lookup = vi.fn();
    const nft = await decodeCalldata(calldata, lookup, { target, contractAbi: { status: 'verified', functions: [...erc721] } });
    expect(nft).toMatchObject({ signatureSource: 'verified', abiStatus: 'matched', explainKey: 'nftTokenApproval' });
    expect(nft.params[1]).toMatchObject({ name: 'nftId', value: '0', isTokenId: true });

    const token = await decodeCalldata(calldata, lookup, { target, contractAbi: { status: 'verified', functions: [...erc20] } });
    expect(token).toMatchObject({ signatureSource: 'verified', abiStatus: 'matched', explainKey: 'erc20ApprovalRevoked' });
    expect(token.params[1]).toMatchObject({ name: 'allowanceValue', value: '0' });
    const maximum = await decodeCalldata(APPROVE_MAX, lookup, { target, contractAbi: { status: 'verified', functions: [...erc20] } });
    expect(maximum).toMatchObject({ explainKey: 'erc20Approval', danger: 'high' });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('uses the verified root ABI in the call tree without assigning ERC-20 allowance findings to an NFT id', async () => {
    const decoded = await decodeCalldata(APPROVE_MAX, vi.fn(), { target, contractAbi: { status: 'verified', functions: [...erc721] } });
    const tree = buildCallTree({ to: target, data: APPROVE_MAX }, { verifiedRoot: decoded.verifiedCall });
    expect(tree.root.params[1]).toMatchObject({ name: 'nftId' });
    expect(tree.root.riskFindings.map((finding) => finding.code)).not.toContain('erc20-max-allowance');
  });

  it('retains selector-based ambiguity if the target ABI did not match', async () => {
    const calldata = encodeFunctionData({ abi: erc721, functionName: 'approve', args: [spender, 0n] });
    const mismatchedAbi = parseAbi(['function other(uint256 value)']);
    const decoded = await decodeCalldata(calldata, vi.fn(), { target, contractAbi: { status: 'verified', functions: [...mismatchedAbi] } });
    expect(decoded).toMatchObject({ signatureSource: 'local', abiStatus: 'no-match', explainKey: 'approveZeroAmbiguous' });
  });

  it('preserves tuple components from the verified ABI', async () => {
    const abi = parseAbi(['function configure((address recipient, uint256 weight)[] options)']);
    const calldata = encodeFunctionData({ abi, functionName: 'configure', args: [[{ recipient: spender, weight: 7n }]] });
    const functions = parseVerifiedFunctions(JSON.parse(JSON.stringify(abi)));
    expect(functions).toBeDefined();
    const decoded = await decodeCalldata(calldata, vi.fn(), { target, contractAbi: { status: 'verified', functions: functions ?? [] } });
    expect(decoded).toMatchObject({ signatureSource: 'verified', functionName: 'configure' });
    expect(decoded.params[0]).toMatchObject({ name: 'options', type: 'tuple[]' });
    expect(decoded.params[0].value).toContain('"weight":"7"');
  });

  it('decodes built-in container ABIs locally without calling OpenChain', async () => {
    const lookup = vi.fn();
    const aggregate = await decodeCalldata(NESTED_MULTICALL_EXAMPLE, lookup);
    expect(aggregate).toMatchObject({ signatureSource: 'local', functionName: 'aggregate3' });

    const safeData = encodeSafeExecTransaction({
      to: target,
      operation: 0,
      data: APPROVE_MAX,
    });
    const safe = await decodeCalldata(safeData, lookup);
    expect(safe).toMatchObject({ signatureSource: 'local', functionName: 'execTransaction' });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('resolves calls through proxy implementation ABIs and preserves approval interface typing', async () => {
    const impl = '0x0000000000000000000000000000000000000099';
    const proxyAbi = parseAbi(['function implementation() view returns (address)']);
    const lookup = vi.fn();
    const decoded = await decodeCalldata(APPROVE_MAX, lookup, {
      target,
      contractAbi: {
        status: 'verified',
        functions: [...proxyAbi],
        implementation: { address: impl, functions: [...erc20] },
      },
    });
    expect(decoded).toMatchObject({
      signatureSource: 'verified',
      abiStatus: 'matched',
      explainKey: 'erc20Approval',
      danger: 'high',
    });
    expect(decoded.verifiedCall?.viaProxyImplementation).toBe(impl);
    expect(decoded.verifiedCall?.approvalInterface).toBe('erc20');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('skips the explorer current proxy implementation ABI for mined historical transactions', async () => {
    const impl = '0x0000000000000000000000000000000000000099';
    const proxyAbi = parseAbi(['function implementation() view returns (address)']);
    const lookup = vi.fn();

    const historical = await decodeCalldata(APPROVE_MAX, lookup, {
      transaction: { value: 0n, blockNumber: 42n },
      target,
      contractAbi: {
        status: 'verified',
        functions: [...proxyAbi],
        implementation: { address: impl, functions: [...erc20] },
      },
    });

    expect(historical).toMatchObject({
      signatureSource: 'local',
      abiStatus: 'proxy-historical',
    });
    expect(historical.verifiedCall).toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();

    const pending = await decodeCalldata(APPROVE_MAX, lookup, {
      transaction: { value: 0n, blockNumber: null },
      target,
      contractAbi: {
        status: 'verified',
        functions: [...proxyAbi],
        implementation: { address: impl, functions: [...erc20] },
      },
    });

    expect(pending).toMatchObject({
      signatureSource: 'verified',
      abiStatus: 'matched',
    });
    expect(pending.verifiedCall?.viaProxyImplementation).toBe(impl);
  });
});
