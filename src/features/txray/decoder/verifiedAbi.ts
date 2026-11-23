import { getAddress, isAddress, toFunctionSelector, toFunctionSignature, type AbiFunction, type AbiParameter, type Address } from 'viem';
import { isRecord } from '@/lib/validation';

export interface VerifiedImplementation {
  address: Address;
  functions: AbiFunction[];
}

export type VerifiedAbiResult =
  | {
      status: 'verified';
      functions: AbiFunction[];
      implementation?: VerifiedImplementation;
    }
  | { status: 'unverified' | 'unavailable' };

export type ApprovalInterface = 'erc20' | 'erc721';

export interface VerifiedCall {
  abi: AbiFunction;
  approvalInterface?: ApprovalInterface;
  viaProxyImplementation?: Address;
}

const MAX_ABI_ITEMS = 2048;
const MAX_PARAMETERS = 128;
const MAX_TUPLE_DEPTH = 12;
const PARAMETER_TYPE = /^[a-zA-Z][a-zA-Z0-9]*(?:\[\d*\])*$/;

export function parseVerifiedFunctions(value: unknown): AbiFunction[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_ABI_ITEMS) return undefined;
  const functions: AbiFunction[] = [];
  for (const item of value) {
    if (!isRecord(item)) return undefined;
    if (item.type !== 'function') continue;
    if (typeof item.name !== 'string' || !/^[a-zA-Z_$][\w$]{0,127}$/.test(item.name)) return undefined;
    const inputs = parseParameters(item.inputs, 0);
    const outputs = parseParameters(item.outputs, 0);
    if (!inputs || !outputs) return undefined;
    const mutability = item.stateMutability;
    const stateMutability = mutability === 'pure' || mutability === 'view' || mutability === 'payable' || mutability === 'nonpayable'
      ? mutability
      : item.constant === true ? 'view' : item.payable === true ? 'payable' : 'nonpayable';
    functions.push({ type: 'function', name: item.name, inputs, outputs, stateMutability });
  }
  return functions;
}

function parseParameters(value: unknown, depth: number): AbiParameter[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_PARAMETERS || depth > MAX_TUPLE_DEPTH) return undefined;
  const parameters: AbiParameter[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.type !== 'string' || item.type.length > 128 || !PARAMETER_TYPE.test(item.type) ||
      (item.name !== undefined && (typeof item.name !== 'string' || item.name.length > 128))) return undefined;
    const parameter: AbiParameter = { name: item.name || undefined, type: item.type };
    if (item.type === 'tuple' || item.type.startsWith('tuple[')) {
      const components = parseParameters(item.components, depth + 1);
      if (!components) return undefined;
      parameters.push({ ...parameter, components });
    } else {
      parameters.push(parameter);
    }
  }
  return parameters;
}

export function selectVerifiedFunction(functions: readonly AbiFunction[], selector: string): AbiFunction | undefined {
  let match: AbiFunction | undefined;
  for (const item of functions) {
    if (toFunctionSelector(item) !== selector) continue;
    if (match) return undefined;
    match = item;
  }
  return match;
}

export function matchVerifiedCall(
  contractAbi: VerifiedAbiResult | undefined,
  selector: string,
): { abi: AbiFunction; functions: AbiFunction[]; viaProxyImplementation?: Address } | undefined {
  if (contractAbi?.status !== 'verified') return undefined;
  if (contractAbi.implementation) {
    const implMatch = selectVerifiedFunction(contractAbi.implementation.functions, selector);
    if (implMatch) {
      return {
        abi: implMatch,
        functions: contractAbi.implementation.functions,
        viaProxyImplementation: contractAbi.implementation.address,
      };
    }
  }
  const directMatch = selectVerifiedFunction(contractAbi.functions, selector);
  if (directMatch) {
    return { abi: directMatch, functions: contractAbi.functions };
  }
  return undefined;
}

export function getApprovalInterface(abi: AbiFunction, functions: readonly AbiFunction[]): ApprovalInterface | undefined {
  if (toFunctionSignature(abi) !== 'approve(address,uint256)') return undefined;
  const signatures = new Map(functions.map((item) => [toFunctionSignature(item), item.outputs]));
  const hasResult = (signature: string, type: string) => {
    const outputs = signatures.get(signature);
    return outputs?.length === 1 && outputs[0].type === type;
  };
  if (!signatures.has('allowance(address,address)') && hasResult('ownerOf(uint256)', 'address') && hasResult('getApproved(uint256)', 'address') &&
    hasResult('isApprovedForAll(address,address)', 'bool') && hasResult('supportsInterface(bytes4)', 'bool') && abi.outputs.length === 0) {
    return 'erc721';
  }
  if (!signatures.has('ownerOf(uint256)') && hasResult('approve(address,uint256)', 'bool') &&
    hasResult('allowance(address,address)', 'uint256') && hasResult('balanceOf(address)', 'uint256') &&
    hasResult('transfer(address,uint256)', 'bool') && hasResult('transferFrom(address,address,uint256)', 'bool')) {
    return 'erc20';
  }
  return undefined;
}

export async function fetchVerifiedAbi(chainId: number, address: Address, signal: AbortSignal): Promise<VerifiedAbiResult> {
  try {
    const query = new URLSearchParams({ chainId: String(chainId), address });
    const response = await fetch(`/api/contract-abi?${query}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
    });
    if (!response.ok) return { status: 'unavailable' };
    const result: unknown = await response.json();
    if (isRecord(result)) {
      if (result.status === 'unverified') return { status: 'unverified' };
      if (result.status === 'verified') {
        const functions = result.functions === undefined ? [] : parseVerifiedFunctions(result.functions);
        let implementation: VerifiedImplementation | undefined;
        if (isRecord(result.implementation) && typeof result.implementation.address === 'string' && isAddress(result.implementation.address)) {
          const implFunctions = parseVerifiedFunctions(result.implementation.functions);
          if (implFunctions) {
            implementation = {
              address: getAddress(result.implementation.address),
              functions: implFunctions,
            };
          }
        }
        if (functions && (functions.length > 0 || implementation || result.functions !== undefined)) {
          return {
            status: 'verified',
            functions,
            ...(implementation ? { implementation } : {}),
          };
        }
      }
    }
  } catch {
    // Decode from local signatures when the explorer cannot be reached.
  }
  return { status: 'unavailable' };
}
