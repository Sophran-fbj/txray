import { describe, expect, it } from 'vitest';
import { analyzeTypedData } from './analyzer';

describe('deadline bounds', () => {
  it.each([(2n ** 48n - 1n).toString(), (2n ** 256n - 1n).toString()])(
    'keeps %s as a finite future timestamp outside the Date range',
    (deadline) => {
      const result = analyzeTypedData(JSON.stringify({ message: { deadline } }));
      expect(result.findings).toContainEqual(expect.objectContaining({
        kind: 'deadline', value: deadline, expired: false, severity: 'medium',
        deadline: { dateMs: undefined, daysRemaining: undefined },
      }));
    },
  );

  it('handles zero and rejects values outside uint256', () => {
    const deadlineZero = analyzeTypedData(JSON.stringify({ message: { deadline: '0' } }));
    expect(deadlineZero.findings[0]).toMatchObject({ expired: true, deadline: { dateMs: 0 } });
    const beyondUint = analyzeTypedData(JSON.stringify({ message: { deadline: (2n ** 256n).toString() } }));
    expect(beyondUint.findings[0].deadline).toBeUndefined();
  });

  it('does not call the uint160 maximum unlimited for a declared uint256 amount', () => {
    const value = (2n ** 160n - 1n).toString();
    const result = analyzeTypedData(JSON.stringify({
      primaryType: 'Transfer', types: { Transfer: [{ name: 'value', type: 'uint256' }] }, message: { value },
    }));
    expect(result.findings[0]).toMatchObject({ value, severity: 'medium', maximumAmountType: undefined });
  });
});

const MAX_UINT256 =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';

describe('analyzeTypedData', () => {
  it('flags unlimited ERC-20 permit signatures as high risk', () => {
    const result = analyzeTypedData(
      JSON.stringify({
        domain: {
          name: 'USD Coin',
          verifyingContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        },
        primaryType: 'Permit',
        message: {
          owner: '0xFb3C2B2769A2119f349233A44A640F090C907667',
          spender: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
          value: MAX_UINT256,
          nonce: '8',
          deadline: '4102444800',
        },
      }),
    );

    expect(result.danger).toBe('high');
    expect(result.title).toBe('ERC-20 permit approval');
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Spender',
          value: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
        }),
        expect.objectContaining({
          label: 'Amount',
          value: 'Unlimited (uint256 max)',
          severity: 'high',
        }),
      ]),
    );
  });

  it('recognizes nested Permit2 payloads', () => {
    const result = analyzeTypedData(
      JSON.stringify({
        domain: {
          name: 'Permit2',
          verifyingContract: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
        },
        primaryType: 'PermitSingle',
        message: {
          details: {
            token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            amount: '1461501637330902918203684832716283019655932542975',
            expiration: '4102444800',
            nonce: '12',
          },
          spender: '0xEf1c6E67703c7BD7107eed8303Fbe6EC2554BF6B',
          sigDeadline: '4102444800',
        },
      }),
    );

    expect(result.danger).toBe('high');
    expect(result.title).toBe('Permit2 token spending approval');
    expect(result.permit2Mode).toBe('allowance');
    expect(result.findings.some((f) => f.label === 'Token')).toBe(true);
    expect(result.findings.some((f) => f.label === 'Spender')).toBe(true);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'amount',
          value: 'Unlimited (uint160 max)',
          severity: 'high',
        }),
      ]),
    );
    expect(result.schemaValidated).toBe(false);
  });

  it('distinguishes one-time Permit2 transfer from a standing allowance', () => {
    const result = analyzeTypedData(JSON.stringify({
      domain: { name: 'Permit2' },
      primaryType: 'PermitTransferFrom',
      message: {
        permitted: {
          token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          amount: '100',
        },
        nonce: '7',
        deadline: '4102444800',
      },
    }));

    expect(result.riskKind).toBe('permit2');
    expect(result.permit2Mode).toBe('transfer');
    expect(result.explain).toContain('does not create a standing');
  });

  it('handles hex-encoded unsigned amounts without treating zero as a positive allowance', () => {
    const message = {
      owner: '0xFb3C2B2769A2119f349233A44A640F090C907667',
      spender: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      deadline: '4102444800',
    };
    const analyzeAmount = (value: string) => analyzeTypedData(JSON.stringify({
      domain: { name: 'Token' }, primaryType: 'Permit',
      message: { ...message, value },
    }));

    expect(analyzeAmount('0x0').danger).toBe('medium');
    const unlimited = analyzeAmount(`0x${(2n ** 256n - 1n).toString(16)}`);
    expect(unlimited.danger).toBe('high');
    expect(unlimited.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'Unlimited (uint256 max)' }),
    ]));
  });

  it('walks every item in a Permit2 batch using the declared schema', () => {
    const result = analyzeTypedData(
      JSON.stringify({
        domain: { name: 'Permit2', chainId: 1 },
        primaryType: 'PermitBatch',
        types: {
          PermitDetails: [
            { name: 'token', type: 'address' },
            { name: 'amount', type: 'uint160' },
            { name: 'expiration', type: 'uint48' },
            { name: 'nonce', type: 'uint48' },
          ],
          PermitBatch: [
            { name: 'details', type: 'PermitDetails[]' },
            { name: 'spender', type: 'address' },
            { name: 'sigDeadline', type: 'uint256' },
          ],
        },
        message: {
          details: [
            {
              token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
              amount: '1',
              expiration: '4102444800',
              nonce: '1',
            },
            {
              token: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
              amount: '2',
              expiration: '4102444800',
              nonce: '2',
            },
          ],
          spender: '0xEf1c6E67703c7BD7107eed8303Fbe6EC2554BF6B',
          sigDeadline: '4102444800',
        },
      }),
    );

    expect(result.findings.filter((finding) => finding.kind === 'token')).toHaveLength(2);
    expect(result.findings.filter((finding) => finding.kind === 'amount')).toHaveLength(2);
    expect(result.findings.some((finding) => finding.path === 'message.details[1].amount')).toBe(true);
    expect(result.schemaValidated).toBe(true);
  });

  it('parses JSON-RPC params when typed data is encoded as a JSON string', () => {
    const typedData = {
      domain: { name: 'USD Coin' },
      primaryType: 'Permit',
      message: {
        owner: '0xFb3C2B2769A2119f349233A44A640F090C907667',
        spender: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
        value: '10',
        deadline: '4102444800',
      },
    };
    const result = analyzeTypedData(
      JSON.stringify({ jsonrpc: '2.0', method: 'eth_signTypedData_v4', params: ['0x0', JSON.stringify(typedData)] }),
    );

    expect(result.riskKind).toBe('erc20-permit');
    expect(result.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'spender' })]),
    );
  });

  it('does not treat an unverified expired deadline as proof of low risk', () => {
    const result = analyzeTypedData(
      JSON.stringify({
        domain: { name: 'USD Coin' },
        primaryType: 'Permit',
        message: {
          owner: '0xFb3C2B2769A2119f349233A44A640F090C907667',
          spender: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
          value: '10',
          deadline: '1',
        },
      }),
    );

    expect(result.signatureExpired).toBe(true);
    expect(result.schemaValidated).toBe(false);
    expect(result.danger).toBe('high');
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'deadline', expired: true, severity: 'unknown' }),
      ]),
    );
  });

  it('keeps order-style signatures high risk when a claimed deadline has passed', () => {
    const result = analyzeTypedData(JSON.stringify({
      domain: { name: 'Seaport' },
      primaryType: 'Order',
      message: {
        offer: [{ token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' }],
        consideration: [{ recipient: '0xE592427A0AEce92De3Edee1F18E0157C05861564' }],
        deadline: '1',
      },
    }));

    expect(result.signatureExpired).toBe(true);
    expect(result.riskKind).toBe('nft-order');
    expect(result.danger).toBe('high');
  });

  it('builds a give-vs-receive order summary flagging zero-return Seaport orders', () => {
    const offerer = '0x1111111111111111111111111111111111111111';
    const attacker = '0x2222222222222222222222222222222222222222';
    const nft = '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D';
    const result = analyzeTypedData(JSON.stringify({
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        OrderComponents: [
          { name: 'offerer', type: 'address' },
          { name: 'zone', type: 'address' },
          { name: 'offer', type: 'OfferItem[]' },
          { name: 'consideration', type: 'ConsiderationItem[]' },
          { name: 'orderType', type: 'uint8' },
          { name: 'startTime', type: 'uint256' },
          { name: 'endTime', type: 'uint256' },
          { name: 'zoneHash', type: 'bytes32' },
          { name: 'salt', type: 'uint256' },
          { name: 'conduitKey', type: 'bytes32' },
          { name: 'counter', type: 'uint256' },
        ],
        OfferItem: [
          { name: 'itemType', type: 'uint8' },
          { name: 'token', type: 'address' },
          { name: 'identifierOrCriteria', type: 'uint256' },
          { name: 'startAmount', type: 'uint256' },
          { name: 'endAmount', type: 'uint256' },
        ],
        ConsiderationItem: [
          { name: 'itemType', type: 'uint8' },
          { name: 'token', type: 'address' },
          { name: 'identifierOrCriteria', type: 'uint256' },
          { name: 'startAmount', type: 'uint256' },
          { name: 'endAmount', type: 'uint256' },
          { name: 'recipient', type: 'address' },
        ],
      },
      domain: {
        name: 'Seaport',
        version: '1.5',
        chainId: 1,
        verifyingContract: '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC',
      },
      primaryType: 'OrderComponents',
      message: {
        offerer,
        zone: '0x0000000000000000000000000000000000000000',
        offer: [
          {
            itemType: 2,
            token: nft,
            identifierOrCriteria: '4242',
            startAmount: '1',
            endAmount: '1',
          },
        ],
        consideration: [
          {
            itemType: 2,
            token: nft,
            identifierOrCriteria: '4242',
            startAmount: '1',
            endAmount: '1',
            recipient: attacker,
          },
        ],
        orderType: 0,
        startTime: '1700000000',
        endTime: '4102444800',
        zoneHash: `0x${'00'.repeat(32)}`,
        salt: '1',
        conduitKey: `0x${'00'.repeat(32)}`,
        counter: '0',
      },
    }));

    expect(result.schemaValidated).toBe(true);
    expect(result.riskKind).toBe('nft-order');
    expect(result.danger).toBe('high');
    expect(result.orderSummary?.zeroReturnToOfferer).toBe(true);
    expect(result.orderSummary?.give).toHaveLength(1);
    expect(result.orderSummary?.give[0]?.itemType).toBe('erc721');
    expect(result.orderSummary?.receiveByOfferer).toHaveLength(0);
    expect(result.orderSummary?.receiveByOthers).toHaveLength(1);
    expect(result.orderSummary?.receiveByOthers[0]?.recipient).toBe(attacker);
  });

  it('recognizes offerer payment in Seaport consideration as non-zero return', () => {
    const offerer = '0x1111111111111111111111111111111111111111';
    const result = analyzeTypedData(JSON.stringify({
      domain: { name: 'Seaport', chainId: 1 },
      primaryType: 'OrderComponents',
      message: {
        offerer,
        offer: [
          {
            itemType: 2,
            token: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D',
            identifierOrCriteria: '7',
            startAmount: '1',
            endAmount: '1',
          },
        ],
        consideration: [
          {
            itemType: 0,
            token: '0x0000000000000000000000000000000000000000',
            identifierOrCriteria: '0',
            startAmount: '1500000000000000000',
            endAmount: '1500000000000000000',
            recipient: offerer,
          },
        ],
        endTime: '4102444800',
      },
    }));

    expect(result.orderSummary?.zeroReturnToOfferer).toBe(false);
    expect(result.orderSummary?.receiveByOfferer).toHaveLength(1);
    expect(result.orderSummary?.receiveByOfferer[0]?.itemType).toBe('native');
    expect(result.orderSummary?.receiveByOthers).toHaveLength(0);
  });

  it('does not flag zeroReturnToOfferer when order message omits offerer', () => {
    const result = analyzeTypedData(JSON.stringify({
      domain: { name: 'Seaport' },
      primaryType: 'Order',
      message: {
        offer: [{ token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', startAmount: '100' }],
        consideration: [{ recipient: '0xE592427A0AEce92De3Edee1F18E0157C05861564', startAmount: '100' }],
      },
    }));

    expect(result.orderSummary?.zeroReturnToOfferer).toBe(false);
    expect(result.orderSummary?.give).toHaveLength(1);
    expect(result.orderSummary?.receiveByOthers).toHaveLength(1);
  });

  it('classifies empty-consideration orders as high-risk nft-order and flags zeroReturnToOfferer', () => {
    const offerer = '0x1111111111111111111111111111111111111111';
    const nft = '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D';
    const fullOrder = analyzeTypedData(JSON.stringify({
      types: {
        EIP712Domain: [{ name: 'name', type: 'string' }],
        OrderComponents: [
          { name: 'offerer', type: 'address' },
          { name: 'offer', type: 'OfferItem[]' },
          { name: 'consideration', type: 'ConsiderationItem[]' },
        ],
        OfferItem: [
          { name: 'itemType', type: 'uint8' },
          { name: 'token', type: 'address' },
          { name: 'identifierOrCriteria', type: 'uint256' },
          { name: 'startAmount', type: 'uint256' },
          { name: 'endAmount', type: 'uint256' },
        ],
        ConsiderationItem: [
          { name: 'itemType', type: 'uint8' },
          { name: 'token', type: 'address' },
          { name: 'identifierOrCriteria', type: 'uint256' },
          { name: 'startAmount', type: 'uint256' },
          { name: 'endAmount', type: 'uint256' },
          { name: 'recipient', type: 'address' },
        ],
      },
      domain: { name: 'Seaport' },
      primaryType: 'OrderComponents',
      message: {
        offerer,
        offer: [
          {
            itemType: 2,
            token: nft,
            identifierOrCriteria: '4242',
            startAmount: '1',
            endAmount: '1',
          },
        ],
        consideration: [],
      },
    }));

    expect(fullOrder.schemaValidated).toBe(true);
    expect(fullOrder.riskKind).toBe('nft-order');
    expect(fullOrder.danger).toBe('high');
    expect(fullOrder.orderSummary?.zeroReturnToOfferer).toBe(true);
    expect(fullOrder.orderSummary?.give).toHaveLength(1);
    expect(fullOrder.orderSummary?.receiveByOfferer).toHaveLength(0);
    expect(fullOrder.orderSummary?.receiveByOthers).toHaveLength(0);

    const partialWithoutOfferer = analyzeTypedData(JSON.stringify({
      domain: { name: 'Seaport' },
      primaryType: 'Order',
      message: {
        offer: [
          {
            itemType: 2,
            token: nft,
            identifierOrCriteria: '7',
            startAmount: '1',
            endAmount: '1',
          },
        ],
        consideration: [],
      },
    }));

    expect(partialWithoutOfferer.riskKind).toBe('nft-order');
    expect(partialWithoutOfferer.danger).toBe('high');
    expect(partialWithoutOfferer.orderSummary?.zeroReturnToOfferer).toBe(true);
  });

  it('ignores unsigned extra fields outside EIP-712 types when classifying and summarizing orders', () => {
    const offerer = '0x1111111111111111111111111111111111111111';
    const nft = '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D';

    // 1.ConsiderationItem only signs itemType/token; injected startAmount/recipient in message are not signed.
    const decoyConsideration = analyzeTypedData(JSON.stringify({
      types: {
        EIP712Domain: [{ name: 'name', type: 'string' }],
        OrderComponents: [
          { name: 'offerer', type: 'address' },
          { name: 'offer', type: 'OfferItem[]' },
          { name: 'consideration', type: 'ConsiderationItem[]' },
        ],
        OfferItem: [
          { name: 'itemType', type: 'uint8' },
          { name: 'token', type: 'address' },
          { name: 'startAmount', type: 'uint256' },
        ],
        ConsiderationItem: [
          { name: 'itemType', type: 'uint8' },
          { name: 'token', type: 'address' },
        ],
      },
      domain: { name: 'Seaport' },
      primaryType: 'OrderComponents',
      message: {
        offerer,
        offer: [{ itemType: 2, token: nft, startAmount: '1' }],
        consideration: [
          {
            itemType: 0,
            token: '0x0000000000000000000000000000000000000000',
            startAmount: '1000000000000000000',
            recipient: offerer,
          },
        ],
      },
    }));

    expect(decoyConsideration.schemaValidated).toBe(true);
    expect(decoyConsideration.orderSummary?.receiveByOfferer).toHaveLength(0);
    expect(decoyConsideration.orderSummary?.receiveByOthers[0]?.recipient).toBeUndefined();
    expect(decoyConsideration.orderSummary?.receiveByOthers[0]?.startAmount).toBeUndefined();
    expect(decoyConsideration.orderSummary?.zeroReturnToOfferer).toBe(true);

    // 2.PrimaryType Vote only signs proposalId; unsigned offer/consideration decoys must not create an orderSummary.
    const decoyVote = analyzeTypedData(JSON.stringify({
      types: {
        EIP712Domain: [{ name: 'name', type: 'string' }],
        Vote: [{ name: 'proposalId', type: 'uint256' }],
      },
      domain: { name: 'Seaport' },
      primaryType: 'Vote',
      message: {
        proposalId: '1',
        offer: [{ itemType: 2, token: nft, startAmount: '1' }],
        consideration: [{ itemType: 0, startAmount: '1', recipient: offerer }],
      },
    }));

    expect(decoyVote.riskKind).toBe('unknown');
    expect(decoyVote.orderSummary).toBeUndefined();
  });

  it('does not pretend unknown typed data is classified', () => {
    const result = analyzeTypedData(
      JSON.stringify({
        domain: { name: 'Example App' },
        primaryType: 'Vote',
        message: { proposalId: '7', support: true },
      }),
    );

    expect(result.danger).toBe('unknown');
    expect(result.title).toBe('Unknown typed-data signature');
    expect(result.findings).toHaveLength(0);
  });
});
