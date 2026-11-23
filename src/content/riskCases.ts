import {
  encodeAbiParameters,
  encodeFunctionData,
  parseAbiItem,
  parseAbiParameters,
  type Address,
  type Hex,
} from 'viem';
import type { LocalizedText } from '@/content/articles';

export type RiskCaseCategory = 'approval' | 'batch' | 'signature';

export interface RiskCaseBase {
  id: string;
  category: RiskCaseCategory;
  severity: 'high';
  title: LocalizedText;
  summary: LocalizedText;
  lure: LocalizedText;
  whatTxRayFinds: LocalizedText;
  articleSlug: string;
  tags: string[];
}

export interface DecoderRiskCase extends RiskCaseBase {
  tool: 'decoder';
  chainId?: number;
  target?: Address;
  calldata: Hex;
}

export interface SignatureRiskCase extends RiskCaseBase {
  tool: 'signature-risk';
  payload: string;
}

export type RiskCase = DecoderRiskCase | SignatureRiskCase;

const MAX_UINT256 = 2n ** 256n - 1n;
const MAX_UINT160 = 2n ** 160n - 1n;
const DISTANT_DEADLINE = 4_102_444_800n;

const ADDR = {
  usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
  bayc: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D' as Address,
  multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11' as Address,
  safeMultiSend: '0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526' as Address,
  safeAccount: '0x9999999999999999999999999999999999999999' as Address,
  universalRouter: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD' as Address,
  permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address,
  seaport: '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC' as Address,
  victim: '0xFb3C2B2769A2119f349233A44A640F090C907667' as Address,
  attacker: '0x2222222222222222222222222222222222222222' as Address,
  benignModule: '0x3333333333333333333333333333333333333333' as Address,
  zero: '0x0000000000000000000000000000000000000000' as Address,
} as const;

const approveAbi = [parseAbiItem('function approve(address spender, uint256 amount)')];
const transferAbi = [parseAbiItem('function transfer(address to, uint256 amount)')];
const setApprovalForAllAbi = [parseAbiItem('function setApprovalForAll(address operator, bool approved)')];
const aggregate3Abi = [
  parseAbiItem('function aggregate3((address target, bool allowFailure, bytes callData)[] calls)'),
];
const safeExecAbi = [
  parseAbiItem(
    'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures)',
  ),
];
const safeMultiSendAbi = [parseAbiItem('function multiSend(bytes transactions)')];
const universalRouterDeadlineAbi = [
  parseAbiItem('function execute(bytes commands, bytes[] inputs, uint256 deadline)'),
];

function packMultiSend(
  calls: Array<{ operation: 0 | 1; to: Address; value?: bigint; data?: Hex }>,
): Hex {
  const packed = calls
    .map((call) => {
      const op = call.operation.toString(16).padStart(2, '0');
      const to = call.to.slice(2).toLowerCase().padStart(40, '0');
      const value = (call.value ?? 0n).toString(16).padStart(64, '0');
      const dataHex = (call.data ?? '0x').slice(2);
      const dataLen = (dataHex.length / 2).toString(16).padStart(64, '0');
      return `${op}${to}${value}${dataLen}${dataHex}`;
    })
    .join('');
  return `0x${packed}` as Hex;
}

const fakeAirdropNftCalldata = encodeFunctionData({
  abi: setApprovalForAllAbi,
  functionName: 'setApprovalForAll',
  args: [ADDR.attacker, true],
});

const multicallHiddenApproveCalldata = encodeFunctionData({
  abi: aggregate3Abi,
  functionName: 'aggregate3',
  args: [
    [
      {
        target: ADDR.usdc,
        allowFailure: false,
        callData: encodeFunctionData({
          abi: transferAbi,
          functionName: 'transfer',
          args: [ADDR.victim, 1_000_000n],
        }),
      },
      {
        target: ADDR.usdc,
        allowFailure: false,
        callData: encodeFunctionData({
          abi: approveAbi,
          functionName: 'approve',
          args: [ADDR.attacker, MAX_UINT256],
        }),
      },
    ],
  ],
});

const safeMultiSendPayload = encodeFunctionData({
  abi: safeMultiSendAbi,
  functionName: 'multiSend',
  args: [
    packMultiSend([
      {
        operation: 1,
        to: ADDR.benignModule,
        data: encodeFunctionData({
          abi: transferAbi,
          functionName: 'transfer',
          args: [ADDR.attacker, 1n],
        }),
      },
      {
        operation: 0,
        to: ADDR.usdc,
        data: encodeFunctionData({
          abi: approveAbi,
          functionName: 'approve',
          args: [ADDR.attacker, MAX_UINT256],
        }),
      },
    ]),
  ],
});

const safeMultiSendDelegateCalldata = encodeFunctionData({
  abi: safeExecAbi,
  functionName: 'execTransaction',
  args: [
    ADDR.safeMultiSend,
    0n,
    safeMultiSendPayload,
    1,
    0n,
    0n,
    0n,
    ADDR.zero,
    ADDR.zero,
    '0x',
  ],
});

const permit2CommandInput = encodeAbiParameters(
  parseAbiParameters(
    '((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permitSingle, bytes data',
  ),
  [
    {
      details: {
        token: ADDR.usdc,
        amount: MAX_UINT160,
        expiration: Number(DISTANT_DEADLINE),
        nonce: 0,
      },
      spender: ADDR.attacker,
      sigDeadline: DISTANT_DEADLINE,
    },
    `0x${'ef'.repeat(65)}`,
  ],
);

const sweepCommandInput = encodeAbiParameters(
  parseAbiParameters('address token, address recipient, uint256 amountMin'),
  [ADDR.usdc, ADDR.attacker, 1n],
);

const universalRouterSweepCalldata = encodeFunctionData({
  abi: universalRouterDeadlineAbi,
  functionName: 'execute',
  args: ['0x0a04', [permit2CommandInput, sweepCommandInput], DISTANT_DEADLINE],
});

const permit2StandingPayload = JSON.stringify(
  {
    domain: {
      name: 'Permit2',
      chainId: 1,
      verifyingContract: ADDR.permit2,
    },
    primaryType: 'PermitSingle',
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      PermitDetails: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint160' },
        { name: 'expiration', type: 'uint48' },
        { name: 'nonce', type: 'uint48' },
      ],
      PermitSingle: [
        { name: 'details', type: 'PermitDetails' },
        { name: 'spender', type: 'address' },
        { name: 'sigDeadline', type: 'uint256' },
      ],
    },
    message: {
      details: {
        token: ADDR.usdc,
        amount: MAX_UINT160.toString(),
        expiration: DISTANT_DEADLINE.toString(),
        nonce: '12',
      },
      spender: ADDR.attacker,
      sigDeadline: DISTANT_DEADLINE.toString(),
    },
  },
  null,
  2,
);

const seaportZeroReturnPayload = JSON.stringify(
  {
    domain: {
      name: 'Seaport',
      version: '1.5',
      chainId: 1,
      verifyingContract: ADDR.seaport,
    },
    primaryType: 'OrderComponents',
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
    message: {
      offerer: ADDR.victim,
      zone: ADDR.zero,
      offer: [
        {
          itemType: 2,
          token: ADDR.bayc,
          identifierOrCriteria: '4242',
          startAmount: '1',
          endAmount: '1',
        },
      ],
      consideration: [
        {
          itemType: 2,
          token: ADDR.bayc,
          identifierOrCriteria: '4242',
          startAmount: '1',
          endAmount: '1',
          recipient: ADDR.attacker,
        },
      ],
      orderType: 0,
      startTime: '1700000000',
      endTime: DISTANT_DEADLINE.toString(),
      zoneHash: `0x${'00'.repeat(32)}`,
      salt: '1',
      conduitKey: '0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000',
      counter: '0',
    },
  },
  null,
  2,
);

export const riskCases: RiskCase[] = [
  {
    id: 'fake-airdrop-nft-approval',
    category: 'approval',
    tool: 'decoder',
    severity: 'high',
    chainId: 1,
    target: ADDR.bayc,
    calldata: fakeAirdropNftCalldata,
    articleSlug: 'why-unlimited-approval-is-dangerous',
    tags: ['ERC-721', 'setApprovalForAll'],
    title: {
      zh: '伪装为空投领取的 NFT 整集合授权',
      en: 'Fake Airdrop Claim Calling setApprovalForAll',
    },
    summary: {
      zh: '前端按钮写着“Claim Airdrop”，但发给你的交易实际是面向高价值 NFT 合约的全集合 operator 授权。',
      en: 'A button labeled “Claim Airdrop” actually asks you to grant collection-wide operator rights on a blue-chip NFT contract.',
    },
    lure: {
      zh: '网站文案宣称只是验证持仓并领取纪念品，通常还伴随倒计时制造紧迫感。',
      en: 'The phishing page claims it is verifying ownership for a free mint with a countdown timer.',
    },
    whatTxRayFinds: {
      zh: 'Decoder 直接识别出 setApprovalForAll(operator, true)，并标记会交出该集合下全部 NFT 控制权。',
      en: 'Decoder identifies setApprovalForAll(operator, true) and warns that the operator can transfer all NFTs in the collection.',
    },
  },
  {
    id: 'multicall-hidden-approve',
    category: 'batch',
    tool: 'decoder',
    severity: 'high',
    chainId: 1,
    target: ADDR.multicall3,
    calldata: multicallHiddenApproveCalldata,
    articleSlug: 'why-batched-transactions-hide-risk',
    tags: ['Multicall3', 'Max Approve'],
    title: {
      zh: 'Multicall 批量调用里夹带无限授权',
      en: 'Unlimited ERC-20 Approve Hidden Inside Multicall3',
    },
    summary: {
      zh: '外层只显示通用 aggregate3 调用，真正的第一步看似无害，第二条子调用把 USDC 无限授权给陌生地址。',
      en: 'The outer transaction only shows a generic aggregate3 call while hiding an unlimited USDC approval in the second subcall.',
    },
    lure: {
      zh: '很多钱包只显示目标合约是官方 Multicall3，用户误以为只是普通聚合交换。',
      en: 'Wallets often highlight the well-known Multicall3 target while leaving nested subcalls opaque.',
    },
    whatTxRayFinds: {
      zh: 'TxRay 递归展开 aggregate3 每个分支，在路径 #1.1 标出 max uint256 approve 与危险 spender。',
      en: 'TxRay expands each aggregate3 branch and surfaces the unlimited approve and spender address at path #1.1.',
    },
  },
  {
    id: 'safe-multisend-delegatecall',
    category: 'batch',
    tool: 'decoder',
    severity: 'high',
    chainId: 1,
    target: ADDR.safeAccount,
    calldata: safeMultiSendDelegateCalldata,
    articleSlug: 'why-batched-transactions-hide-risk',
    tags: ['Safe', 'MultiSend', 'Delegatecall'],
    title: {
      zh: 'Safe MultiSend 压缩包中的内层 delegatecall 与授权',
      en: 'Inner Delegatecall and Approve Hidden in Safe MultiSend',
    },
    summary: {
      zh: 'Safe 的 multiSend 把多笔子交易打包成紧凑字节流，如果不逐段解包就看不到内层的 delegatecall 提权与代币授权。',
      en: 'Safe multiSend packs sub-transactions into a tight byte stream, hiding an inner delegatecall and an unlimited token approval.',
    },
    lure: {
      zh: '多签确认页若只展示交易字节长度或 Safe 壳方法名，成员很容易漏看被夹带的恶意模块调用。',
      en: 'Signers reviewing only the outer Safe wrapper or byte length can easily miss injected module calls.',
    },
    whatTxRayFinds: {
      zh: 'Call Tree 解析 Safe execTransaction 与 MultiSendPacked 子调用，分别标出内层 delegatecall 风险和无限 approve。',
      en: 'Call Tree unpacks Safe execTransaction and MultiSendPacked subcalls, flagging both the inner delegatecall and unlimited approve.',
    },
  },
  {
    id: 'universal-router-permit2-sweep',
    category: 'batch',
    tool: 'decoder',
    severity: 'high',
    chainId: 1,
    target: ADDR.universalRouter,
    calldata: universalRouterSweepCalldata,
    articleSlug: 'why-batched-transactions-hide-risk',
    tags: ['Universal Router', 'Permit2', 'Sweep'],
    title: {
      zh: 'Universal Router 命令流串联 Permit2 授权与 Sweep 转移',
      en: 'Universal Router Command Stream Chaining Permit2 + Sweep',
    },
    summary: {
      zh: '一条 execute(commands, inputs) 先注入持续的 Permit2 授权，紧接着通过 SWEEP 指令把余额扫向第三方地址。',
      en: 'A single execute(commands, inputs) call grants a persistent Permit2 allowance before sweeping remaining funds to an external address.',
    },
    lure: {
      zh: '调用外层是高频使用的官方路由签名，不拆分 command byte 就分不清是正常换币还是权限转移。',
      en: 'Because the outer wrapper looks like a familiar router swap, raw hex alone hides whether commands swap or sweep.',
    },
    whatTxRayFinds: {
      zh: 'TxRay 按 command byte 解出 PERMIT2_PERMIT 与 SWEEP 指令，高亮远期 sigDeadline、无限额度和 SWEEP 收款人。',
      en: 'TxRay splits commands into PERMIT2_PERMIT and SWEEP steps, surfacing the max allowance, distant deadline, and sweep recipient.',
    },
  },
  {
    id: 'permit2-standing-phishing',
    category: 'signature',
    tool: 'signature-risk',
    severity: 'high',
    payload: permit2StandingPayload,
    articleSlug: 'permit2-eip712-phishing',
    tags: ['EIP-712', 'Permit2', 'Gasless'],
    title: {
      zh: '无 Gas 的 Permit2 无限额持续签名钓鱼',
      en: 'Gasless Permit2 Unlimited Standing Allowance Phishing',
    },
    summary: {
      zh: '恶意网站诱导签署链下 PermitSingle；虽然不用付 Gas，但一旦提交即可长期挪走对应代币的全部余额。',
      en: 'Signing an off-chain PermitSingle costs no gas, yet allows the named spender to drain the approved token balance.',
    },
    lure: {
      zh: '签名弹窗不消耗 ETH，常被包装成“登录验证”或“领取奖励授权”。',
      en: 'Because signatures cost zero gas, phishing prompts disguise them as harmless login checks.',
    },
    whatTxRayFinds: {
      zh: 'Signature Risk 通过 EIP-712 类型校验确认结构为 Permit2 持续额度授权，标红 max uint160 额度与攻击者 spender。',
      en: 'Signature Risk schema-validates the PermitSingle payload and highlights the max uint160 allowance and spender.',
    },
  },
  {
    id: 'seaport-zero-return-nft',
    category: 'signature',
    tool: 'signature-risk',
    severity: 'high',
    payload: seaportZeroReturnPayload,
    articleSlug: 'permit2-eip712-phishing',
    tags: ['Seaport', 'NFT Order', 'Zero Return'],
    title: {
      zh: '伪造为正常挂单的 Seaport 零元扫单签名',
      en: 'Seaport Zero-Return NFT Listing Signature',
    },
    summary: {
      zh: '订单把高价值 ERC-721 放进 offer，却把 consideration 接收人写成攻击者地址——签名发起人零回报交出 NFT。',
      en: 'The order places a high-value ERC-721 in offer while routing consideration to an attacker—leaving zero return for the offerer.',
    },
    lure: {
      zh: '钱包对超长结构体只显示少量字段或摘要哈希，用户以为自己在以市场价挂单出售 NFT。',
      en: 'Condensed wallet popups obscure offer vs consideration arrays, tricking sellers into signing away assets for free.',
    },
    whatTxRayFinds: {
      zh: 'Signature Risk 拆出 Offer（交出）与 Consideration（收到）资产对照，明确给出“零回报”高危警告并展示实际接收方。',
      en: 'Signature Risk splits Offer vs Consideration items and triggers a critical zero-return alert showing the external recipient.',
    },
  },
];

export function getRiskCase(id: string): RiskCase | undefined {
  return riskCases.find((item) => item.id === id);
}

export function riskCaseHref(item: RiskCase): string {
  return item.tool === 'decoder'
    ? `/tools/txray/decoder?case=${item.id}`
    : `/tools/signature-risk?case=${item.id}`;
}
