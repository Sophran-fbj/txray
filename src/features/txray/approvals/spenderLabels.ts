import { type Address } from 'viem';

export interface SpenderLabel {
  name: string;
  trusted: boolean;
}

// 常见可信合约标签（地址用小写）。这是「内容资产」，按链严格隔离：
// 命中 = 显示名称 + 可信标记；未命中 = 「未知合约」黄色警示（风险更高）。

const CANONICAL_CREATE2_LABELS: Record<string, SpenderLabel> = {
  '0x000000000022d473030f116ddee9f6b43ac78ba3': { name: 'Uniswap Permit2', trusted: true },
  '0x00000000000000adc04c56bf30ac9d3c0aaf14dc': { name: 'OpenSea Seaport 1.5', trusted: true },
  '0x0000000000000068f116a894984e2db1123eb395': { name: 'OpenSea Seaport 1.6', trusted: true },
  '0x1111111254eeb25477b68fb85ed929f73a960582': { name: '1inch V5 Router', trusted: true },
  '0x111111125421ca6dc452d289314280a0f8842a65': { name: '1inch V6 Router', trusted: true },
};

const MAINNET_LABELS: Record<string, SpenderLabel> = {
  ...CANONICAL_CREATE2_LABELS,
  // Uniswap
  '0x7a250d5630b4cf539739df2c5dacb4c659f2488d': { name: 'Uniswap V2 Router', trusted: true },
  '0xe592427a0aece92de3edee1f18e0157c05861564': { name: 'Uniswap V3 Router', trusted: true },
  '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45': { name: 'Uniswap SwapRouter02', trusted: true },
  '0xef1c6e67703c7bd7107eed8303fbe6ec2554bf6b': { name: 'Uniswap Universal Router V1', trusted: true },
  '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad': { name: 'Uniswap Universal Router', trusted: true },
  '0x66a9893cc07d91d95644aedd05d03f95e1dba8af': { name: 'Uniswap Universal Router V2', trusted: true },
  // 聚合器 / 借贷 / NFT
  '0xdef1c0ded9bec7f1a1670819833240f027b25eff': { name: '0x Exchange Proxy', trusted: true },
  '0x881d40237659c251811cec9c364ef91dc08d300c': { name: 'MetaMask Swap Router', trusted: true },
  '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2': { name: 'Aave V3 Pool', trusted: true },
  '0x000000000000ad05ccc4f10045630fb830b95127': { name: 'Blur Marketplace', trusted: true },
};

const BASE_LABELS: Record<string, SpenderLabel> = {
  ...CANONICAL_CREATE2_LABELS,
  '0x2626664c2603336e57b271c5c0b26f421741e481': { name: 'Uniswap SwapRouter02', trusted: true },
  '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad': { name: 'Uniswap Universal Router', trusted: true },
  '0x6ff5693b99212da76ad316178a184ab56d299b43': { name: 'Uniswap Universal Router V2', trusted: true },
  '0xa238dd80c259a72e81d7e4664a9801593f98d1c5': { name: 'Aave V3 Pool', trusted: true },
};

const ARBITRUM_LABELS: Record<string, SpenderLabel> = {
  ...CANONICAL_CREATE2_LABELS,
  '0xe592427a0aece92de3edee1f18e0157c05861564': { name: 'Uniswap V3 Router', trusted: true },
  '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45': { name: 'Uniswap SwapRouter02', trusted: true },
  '0x5e325eda8064b456f4781070c0738d849c824258': { name: 'Uniswap Universal Router', trusted: true },
  '0xa51afafe0263b40edaef0df8781ea9aa03e381a3': { name: 'Uniswap Universal Router V2', trusted: true },
  '0x794a61358d6845594f94dc1db02a252b5b4814ad': { name: 'Aave V3 Pool', trusted: true },
};

const OPTIMISM_LABELS: Record<string, SpenderLabel> = {
  ...CANONICAL_CREATE2_LABELS,
  '0xe592427a0aece92de3edee1f18e0157c05861564': { name: 'Uniswap V3 Router', trusted: true },
  '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45': { name: 'Uniswap SwapRouter02', trusted: true },
  '0x851116d9223fabed8e56c0e6b8ad0c31d98b3507': { name: 'Uniswap Universal Router V2', trusted: true },
  '0x794a61358d6845594f94dc1db02a252b5b4814ad': { name: 'Aave V3 Pool', trusted: true },
};

const LABELS_BY_CHAIN: Partial<Record<number, Record<string, SpenderLabel>>> = {
  1: MAINNET_LABELS,
  8453: BASE_LABELS,
  42161: ARBITRUM_LABELS,
  10: OPTIMISM_LABELS,
};

export function getSpenderLabel(
  addr: Address,
  chainId = 1,
): SpenderLabel | undefined {
  return LABELS_BY_CHAIN[chainId]?.[addr.toLowerCase()];
}
