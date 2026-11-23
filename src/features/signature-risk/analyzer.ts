import { isAddress, type Address } from 'viem';
import { isRecord } from '@/lib/validation';

export type SignatureDanger = 'high' | 'medium' | 'low' | 'unknown';
export type SignatureFindingKind =
  | 'spender'
  | 'operator'
  | 'conduit'
  | 'token'
  | 'owner'
  | 'amount'
  | 'nonce'
  | 'deadline';
export type SignatureRiskKind =
  | 'unknown'
  | 'permit2'
  | 'erc20-permit'
  | 'nft-order'
  | 'operator';

export interface FieldFinding {
  label: string;
  kind: SignatureFindingKind;
  value: string;
  severity: SignatureDanger;
  explain: string;
  path?: string;
  expired?: boolean;
  maximumAmountType?: string;
  deadline?: { dateMs?: number; daysRemaining?: number };
}

export type OrderItemType =
  | 'native'
  | 'erc20'
  | 'erc721'
  | 'erc1155'
  | 'erc721-criteria'
  | 'erc1155-criteria'
  | 'unknown';

export interface OrderAssetItem {
  itemType: OrderItemType;
  token?: Address;
  identifierOrCriteria?: string;
  startAmount?: string;
  endAmount?: string;
  recipient?: Address;
}

export interface OrderSummary {
  offerer?: Address;
  zone?: Address;
  conduitKey?: string;
  give: OrderAssetItem[];
  receiveByOfferer: OrderAssetItem[];
  receiveByOthers: OrderAssetItem[];
  zeroReturnToOfferer: boolean;
}

export interface SignatureAnalysis {
  domainName?: string;
  chainId?: string;
  verifyingContract?: Address;
  primaryType?: string;
  danger: SignatureDanger;
  riskKind: SignatureRiskKind;
  permit2Mode?: 'allowance' | 'transfer';
  orderSummary?: OrderSummary;
  title: string;
  explain: string;
  findings: FieldFinding[];
  rawMessage?: unknown;
  schemaValidated: boolean;
  signatureExpired: boolean;
}

interface TypedDataField {
  name: string;
  type: string;
}

interface TypedDataLike {
  domain: Record<string, unknown>;
  primaryType?: string;
  message: Record<string, unknown>;
  types?: Record<string, TypedDataField[]>;
}

interface TypedLeaf {
  name: string;
  type?: string;
  value: unknown;
  path: string;
}

const MAX_UINT160 = (2n ** 160n - 1n).toString();
const MAX_UINT256 = (2n ** 256n - 1n).toString();
const MAX_SCHEMA_DEPTH = 16;
const MAX_DATE_SECONDS = 8_640_000_000_000n;
const SECONDS_PER_DAY = 86_400n;

export function analyzeTypedData(input: string): SignatureAnalysis {
  const typedData = normalizeTypedDataShape(parseJson(input));
  const { domain, primaryType, message, types } = typedData;
  const verifyingContract = asAddress(getOwn(domain, 'verifyingContract'));
  if (types && Object.hasOwn(types, 'EIP712Domain')) {
    collectTypedLeaves(types, 'EIP712Domain', domain);
  }
  const leaves = types && primaryType
    ? collectTypedLeaves(types, primaryType, message)
    : collectFallbackLeaves(message);
  const signedMessage = types && primaryType
    ? extractSchemaRecord(types, primaryType, message)
    : message;
  const findings = leaves.flatMap(findingFromLeaf);

  const permitKind = classifyPermit(primaryType, signedMessage, domain);
  const hasUnlimited = findings.some(
    (finding) => finding.kind === 'amount' && finding.severity === 'high',
  );
  const hasPositiveAmount = findings.some(
    (finding) =>
      finding.kind === 'amount' &&
      (finding.severity === 'high' ||
        (finding.severity === 'medium' && parseUnsignedInteger(finding.value) !== 0n)),
  );
  const hasSpender = findings.some((finding) => finding.kind === 'spender');
  const signatureExpired = findings.some(
    (finding) =>
      finding.kind === 'deadline' &&
      finding.expired &&
      /(?:^|\.)(?:deadline|sigDeadline|endTime)$/i.test(finding.path ?? ''),
  );

  let danger: SignatureDanger = 'unknown';
  let riskKind: SignatureRiskKind = 'unknown';
  let title = 'Unknown typed-data signature';
  let explain =
    'Signature Risk cannot confidently classify this typed-data payload. Review every address, amount, and deadline before signing.';

  if (permitKind === 'permit2-allowance' || permitKind === 'permit2-transfer') {
    danger = hasUnlimited || (hasSpender && hasPositiveAmount)
      ? 'high'
      : 'medium';
    riskKind = 'permit2';
    title = 'Permit2 token spending approval';
    explain = permitKind === 'permit2-transfer'
      ? 'This matches a one-time Permit2 transfer signature. It can authorize token movement when submitted, but does not create a standing Permit2 spender allowance.'
      : 'This matches a Permit2 standing allowance signature. It can authorize a spender to move tokens until the allowance is exhausted or expires.';
  } else if (permitKind === 'erc20-permit') {
    danger = hasUnlimited || (hasSpender && hasPositiveAmount)
      ? 'high'
      : 'medium';
    riskKind = 'erc20-permit';
    title = 'ERC-20 permit approval';
    explain = 'This signature can approve token spending without sending an on-chain approve transaction first.';
  } else if (permitKind === 'nft-order') {
    danger = 'high';
    riskKind = 'nft-order';
    title = 'NFT or order signature';
    explain = 'This looks like an order-style signature. Signing can authorize a marketplace or conduit to move NFTs or settle an order.';
  }

  const rawDomainName = getOwn(domain, 'name');
  return {
    domainName: typeof rawDomainName === 'string' ? rawDomainName : undefined,
    chainId: scalarText(getOwn(domain, 'chainId')),
    verifyingContract,
    primaryType,
    danger,
    riskKind,
    permit2Mode: permitKind === 'permit2-allowance'
      ? 'allowance'
      : permitKind === 'permit2-transfer' ? 'transfer' : undefined,
    orderSummary: permitKind === 'nft-order' ? buildOrderSummary(signedMessage) : undefined,
    title,
    explain,
    findings,
    rawMessage: message,
    schemaValidated: Boolean(types && primaryType),
    signatureExpired,
  };
}

function parseJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    throw new Error('Input is not valid JSON.');
  }
}

function parseTypedDataCandidate(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return isRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return isRecord(value) ? value : undefined;
}

function getOwn(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function getOwnStruct(
  types: Record<string, TypedDataField[]>,
  type: string,
): TypedDataField[] | undefined {
  return Object.hasOwn(types, type) ? types[type] : undefined;
}

function parseTypes(value: unknown): Record<string, TypedDataField[]> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error('Typed data types must be an object.');

  const output = Object.create(null) as Record<string, TypedDataField[]>;
  for (const [typeName, fields] of Object.entries(value)) {
    if (!Array.isArray(fields)) throw new Error(`Type ${typeName} must be an array.`);
    const names = new Set<string>();
    const parsedFields = fields.map((field) => {
      if (
        !isRecord(field) ||
        typeof field.name !== 'string' ||
        typeof field.type !== 'string'
      ) {
        throw new Error(`Type ${typeName} contains an invalid field.`);
      }
      if (names.has(field.name)) throw new Error(`Type ${typeName} repeats field ${field.name}.`);
      names.add(field.name);
      return { name: field.name, type: field.type };
    });
    Object.defineProperty(output, typeName, {
      value: parsedFields,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  for (const [typeName, fields] of Object.entries(output)) {
    for (const field of fields) {
      const baseType = field.type.replace(/(\[\d*\])+$/, '');
      const suffix = field.type.slice(baseType.length);
      if (
        !/^(\[\d*\])*$/.test(suffix) ||
        (!isPrimitiveType(baseType) && !Object.hasOwn(output, baseType))
      ) {
        throw new Error(`Type ${typeName}.${field.name} has unsupported type ${field.type}.`);
      }
    }
  }
  return output;
}

function isPrimitiveType(type: string): boolean {
  if (type === 'address' || type === 'bool' || type === 'string' || type === 'bytes') return true;
  if (/^bytes(?:[1-9]|[12]\d|3[012])$/.test(type)) return true;
  const integer = /^(?:u?int)(\d+)$/.exec(type);
  if (!integer) return false;
  const bits = Number(integer[1]);
  return bits >= 8 && bits <= 256 && bits % 8 === 0;
}

function normalizeTypedDataShape(parsed: unknown): TypedDataLike {
  if (!isRecord(parsed)) throw new Error('Input must be a typed-data JSON object.');

  let candidate = parsed;
  const nestedTypedData = getOwn(parsed, 'typedData');
  const nestedParams = getOwn(parsed, 'params');
  if (nestedTypedData !== undefined) {
    const nested = parseTypedDataCandidate(nestedTypedData);
    if (!nested) throw new Error('typedData must contain a JSON object.');
    candidate = nested;
  } else if (Array.isArray(nestedParams)) {
    const nested = nestedParams
      .map(parseTypedDataCandidate)
      .find((item) => item && isRecord(getOwn(item, 'message')));
    if (nested) candidate = nested;
  }

  const candidateMessage = getOwn(candidate, 'message');
  if (!isRecord(candidateMessage)) {
    throw new Error('Typed data must contain a message object.');
  }
  const candidateDomain = getOwn(candidate, 'domain');
  if (candidateDomain !== undefined && !isRecord(candidateDomain)) {
    throw new Error('Typed data domain must be an object.');
  }
  const candidatePrimaryType = getOwn(candidate, 'primaryType');
  if (candidatePrimaryType !== undefined && typeof candidatePrimaryType !== 'string') {
    throw new Error('Typed data primaryType must be a string.');
  }

  const types = parseTypes(getOwn(candidate, 'types'));
  const primaryType =
    typeof candidatePrimaryType === 'string' ? candidatePrimaryType : undefined;
  if (types && primaryType && !getOwnStruct(types, primaryType)) {
    throw new Error(`primaryType ${primaryType} is missing from types.`);
  }

  return {
    domain: isRecord(candidateDomain) ? candidateDomain : {},
    primaryType,
    message: candidateMessage,
    types,
  };
}

function collectTypedLeaves(
  types: Record<string, TypedDataField[]>,
  primaryType: string,
  message: Record<string, unknown>,
): TypedLeaf[] {
  const leaves: TypedLeaf[] = [];

  function visit(type: string, value: unknown, name: string, path: string, depth: number) {
    if (depth > MAX_SCHEMA_DEPTH) throw new Error('Typed-data schema nesting is too deep.');

    const arrayMatch = /^(.*)\[(\d*)\]$/.exec(type);
    if (arrayMatch) {
      if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
      const expectedLength = arrayMatch[2] ? Number(arrayMatch[2]) : undefined;
      if (expectedLength !== undefined && value.length !== expectedLength) {
        throw new Error(`${path} must contain ${expectedLength} items.`);
      }
      value.forEach((item, index) =>
        visit(arrayMatch[1], item, name, `${path}[${index}]`, depth + 1),
      );
      return;
    }

    const struct = getOwnStruct(types, type);
    if (struct) {
      if (!isRecord(value)) throw new Error(`${path} must be an object of type ${type}.`);
      for (const field of struct) {
        if (!Object.hasOwn(value, field.name)) throw new Error(`${path}.${field.name} is missing.`);
        visit(
          field.type,
          getOwn(value, field.name),
          field.name,
          `${path}.${field.name}`,
          depth + 1,
        );
      }
      return;
    }

    validateTypedValue(type, value, path);
    leaves.push({ name, type, value, path });
  }

  visit(primaryType, message, primaryType, 'message', 0);
  return leaves;
}

function extractSchemaRecord(
  types: Record<string, TypedDataField[]>,
  primaryType: string,
  message: Record<string, unknown>,
): Record<string, unknown> {
  const projected = extractSchemaValue(types, primaryType, message, 0);
  return isRecord(projected) ? projected : (Object.create(null) as Record<string, unknown>);
}

function extractSchemaValue(
  types: Record<string, TypedDataField[]>,
  type: string,
  value: unknown,
  depth: number,
): unknown {
  if (depth > MAX_SCHEMA_DEPTH) return undefined;
  const arrayMatch = /^(.*)\[(\d*)\]$/.exec(type);
  if (arrayMatch) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => extractSchemaValue(types, arrayMatch[1], item, depth + 1));
  }
  const struct = getOwnStruct(types, type);
  if (struct) {
    const output = Object.create(null) as Record<string, unknown>;
    if (!isRecord(value)) return output;
    for (const field of struct) {
      Object.defineProperty(output, field.name, {
        value: extractSchemaValue(types, field.type, getOwn(value, field.name), depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return output;
  }
  return value;
}

function validateTypedValue(type: string, value: unknown, path: string): void {
  if (type === 'address') {
    if (typeof value !== 'string' || !isAddress(value)) throw new Error(`${path} must be an address.`);
    return;
  }
  if (type === 'bool') {
    if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean.`);
    return;
  }
  if (type === 'string') {
    if (typeof value !== 'string') throw new Error(`${path} must be a string.`);
    return;
  }
  if (type === 'bytes' || /^bytes\d+$/.test(type)) {
    const bytes = /^bytes(\d+)$/.exec(type);
    if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value) ||
      (bytes && (value.length - 2) / 2 !== Number(bytes[1]))) {
      throw new Error(`${path} must be valid ${type} data.`);
    }
    return;
  }
  const integer = /^(u?int)(\d+)$/.exec(type);
  if (!integer) throw new Error(`${path} has unsupported type ${type}.`);
  const numeric = typeof value === 'number'
    ? Number.isSafeInteger(value) ? BigInt(value) : undefined
    : typeof value === 'string' && /^(?:-?\d+|0x[0-9a-fA-F]+)$/.test(value)
      ? BigInt(value)
      : undefined;
  if (numeric === undefined) throw new Error(`${path} must be a ${type} integer.`);
  const bits = BigInt(integer[2]);
  const signed = integer[1] === 'int';
  const min = signed ? -(2n ** (bits - 1n)) : 0n;
  const max = 2n ** (signed ? bits - 1n : bits) - 1n;
  if (numeric < min || numeric > max) throw new Error(`${path} exceeds the ${type} range.`);
}

function collectFallbackLeaves(value: unknown): TypedLeaf[] {
  const leaves: TypedLeaf[] = [];
  function visit(current: unknown, path: string, depth: number) {
    if (depth > MAX_SCHEMA_DEPTH) throw new Error('Typed-data message nesting is too deep.');
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
      return;
    }
    if (!isRecord(current)) return;
    for (const [name, item] of Object.entries(current)) {
      const itemPath = `${path}.${name}`;
      if (item && typeof item === 'object') visit(item, itemPath, depth + 1);
      else leaves.push({ name, value: item, path: itemPath });
    }
  }
  visit(value, 'message', 0);
  return leaves;
}

function findingFromLeaf(leaf: TypedLeaf): FieldFinding[] {
  const key = leaf.name.toLowerCase();
  const addressKinds: Partial<Record<string, SignatureFindingKind>> = {
    spender: 'spender',
    operator: 'operator',
    conduit: 'conduit',
    token: 'token',
    owner: 'owner',
  };
  const addressKind = addressKinds[key];
  if (addressKind) {
    const address = asAddress(leaf.value);
    if (!address || (leaf.type && leaf.type !== 'address')) return [];
    const label = addressKind[0].toUpperCase() + addressKind.slice(1);
    return [
      {
        label,
        kind: addressKind,
        value: address,
        severity: addressKind === 'owner' ? 'low' : 'medium',
        explain:
          addressKind === 'owner'
            ? 'The wallet that owns the assets or approval.'
            : `${label} may receive permission or participate in settlement.`,
        path: leaf.path,
      },
    ];
  }

  if ((key === 'amount' || key === 'value') && (!leaf.type || /^uint\d*$/.test(leaf.type))) {
    return [amountFinding(leaf.value, leaf.type, leaf.path)];
  }
  if (key === 'nonce' && (!leaf.type || /^uint\d*$/.test(leaf.type))) {
    return [
      {
        label: 'Nonce',
        kind: 'nonce',
        value: stringifyValue(leaf.value),
        severity: 'low',
        explain: 'Nonce prevents replay of the same signature.',
        path: leaf.path,
      },
    ];
  }
  if (['deadline', 'expiration', 'sigdeadline', 'endtime'].includes(key)) {
    return [deadlineFinding(leaf.value, leaf.path)];
  }
  return [];
}

function buildOrderSummary(message: Record<string, unknown>): OrderSummary {
  const offerer = asAddress(getOwn(message, 'offerer'));
  const zone = asAddress(getOwn(message, 'zone'));
  const rawConduitKey = getOwn(message, 'conduitKey');
  const conduitKey = typeof rawConduitKey === 'string' ? rawConduitKey : undefined;
  const rawOffer = getOwn(message, 'offer');
  const rawConsideration = getOwn(message, 'consideration');
  const give = Array.isArray(rawOffer) ? rawOffer.flatMap(parseOrderItem) : [];
  const consideration = Array.isArray(rawConsideration)
    ? rawConsideration.flatMap(parseOrderItem)
    : [];

  const receiveByOfferer: OrderAssetItem[] = [];
  const receiveByOthers: OrderAssetItem[] = [];
  for (const item of consideration) {
    if (offerer && item.recipient && item.recipient.toLowerCase() === offerer.toLowerCase()) {
      receiveByOfferer.push(item);
    } else {
      receiveByOthers.push(item);
    }
  }

  const hasPositiveReturn = receiveByOfferer.some(
    (item) => isPositiveIntegerText(item.startAmount) || isPositiveIntegerText(item.endAmount),
  );

  return {
    offerer,
    zone,
    conduitKey,
    give,
    receiveByOfferer,
    receiveByOthers,
    zeroReturnToOfferer:
      give.length > 0 && (consideration.length === 0 || (Boolean(offerer) && !hasPositiveReturn)),
  };
}

function parseOrderItem(value: unknown): OrderAssetItem[] {
  if (!isRecord(value)) return [];
  return [
    {
      itemType: mapOrderItemType(getOwn(value, 'itemType')),
      token: asAddress(getOwn(value, 'token')),
      identifierOrCriteria: optionalScalarText(getOwn(value, 'identifierOrCriteria')),
      startAmount: optionalScalarText(getOwn(value, 'startAmount')),
      endAmount: optionalScalarText(getOwn(value, 'endAmount')),
      recipient: asAddress(getOwn(value, 'recipient')),
    },
  ];
}

function mapOrderItemType(value: unknown): OrderItemType {
  const numeric = typeof value === 'number' && Number.isSafeInteger(value)
    ? BigInt(value)
    : typeof value === 'string'
      ? parseUnsignedInteger(value)
      : undefined;
  switch (numeric) {
    case 0n: return 'native';
    case 1n: return 'erc20';
    case 2n: return 'erc721';
    case 3n: return 'erc1155';
    case 4n: return 'erc721-criteria';
    case 5n: return 'erc1155-criteria';
    default: return 'unknown';
  }
}

function optionalScalarText(value: unknown): string | undefined {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return undefined;
}

function isPositiveIntegerText(value: string | undefined): boolean {
  if (!value) return false;
  const parsed = parseUnsignedInteger(value);
  return parsed !== undefined && parsed > 0n;
}

function classifyPermit(
  primaryType: string | undefined,
  message: Record<string, unknown>,
  domain: Record<string, unknown>,
): 'permit2-allowance' | 'permit2-transfer' | 'erc20-permit' | 'nft-order' | 'unknown' {
  const rawDomainName = getOwn(domain, 'name');
  const domainName = typeof rawDomainName === 'string' ? rawDomainName.toLowerCase() : '';
  const type = primaryType?.toLowerCase();
  const allowanceType = type === 'permitsingle' || type === 'permitbatch';
  const transferType = type !== undefined && /^permit(?:batch)?(?:witness)?transferfrom$/.test(type);
  const permit2Domain = domainName === 'permit2';
  const isPermission = (item: unknown): boolean =>
    isRecord(item) && Boolean(asAddress(getOwn(item, 'token'))) && isUnsignedValue(getOwn(item, 'amount'));
  const permissionItems = (item: unknown): boolean =>
    Array.isArray(item) ? item.length > 0 && item.every(isPermission) : isPermission(item);
  const isAllowanceDetails = (item: unknown): boolean =>
    isPermission(item) && isRecord(item) &&
    isUnsignedValue(getOwn(item, 'expiration')) && isUnsignedValue(getOwn(item, 'nonce'));
  const allowanceItems = (item: unknown): boolean =>
    Array.isArray(item) ? item.length > 0 && item.every(isAllowanceDetails) : isAllowanceDetails(item);
  const hasAllowanceShape = allowanceItems(getOwn(message, 'details')) &&
    Boolean(asAddress(getOwn(message, 'spender'))) && isUnsignedValue(getOwn(message, 'sigDeadline'));
  const hasTransferShape = permissionItems(getOwn(message, 'permitted')) &&
    isUnsignedValue(getOwn(message, 'nonce')) && isUnsignedValue(getOwn(message, 'deadline'));

  if ((allowanceType || (!type && permit2Domain)) && hasAllowanceShape) return 'permit2-allowance';
  if ((transferType || (!type && permit2Domain)) && hasTransferShape) return 'permit2-transfer';
  if ((type === 'permit' || !type) &&
    Boolean(asAddress(getOwn(message, 'owner'))) && Boolean(asAddress(getOwn(message, 'spender'))) &&
    isUnsignedValue(getOwn(message, 'value')) && isUnsignedValue(getOwn(message, 'deadline'))) {
    return 'erc20-permit';
  }
  const isOrderAssetLike = (item: unknown): boolean =>
    isRecord(item) && (
      asAddress(getOwn(item, 'token')) !== undefined ||
      getOwn(item, 'itemType') !== undefined ||
      getOwn(item, 'startAmount') !== undefined ||
      getOwn(item, 'endAmount') !== undefined ||
      getOwn(item, 'identifierOrCriteria') !== undefined
    );

  const offer = getOwn(message, 'offer');
  const consideration = getOwn(message, 'consideration');
  if (Array.isArray(offer) && offer.length > 0 &&
    offer.every(isOrderAssetLike) &&
    Array.isArray(consideration) &&
    consideration.every(isRecord) &&
    (!type || /order/.test(type))) {
    return 'nft-order';
  }
  return 'unknown';
}

function isUnsignedValue(value: unknown): boolean {
  return (typeof value === 'string' && parseUnsignedInteger(value) !== undefined) ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}

function amountFinding(value: unknown, type: string | undefined, path: string): FieldFinding {
  const text = stringifyValue(value);
  const numeric = parseUnsignedInteger(text);
  const declaredMax = maxValueForUint(type);
  const isUnlimited =
    numeric !== undefined &&
    (type ? numeric === declaredMax : numeric.toString() === MAX_UINT160 || numeric.toString() === MAX_UINT256);
  const isZero = numeric === 0n;
  const maxType = type ?? (numeric?.toString() === MAX_UINT160 ? 'uint160' : numeric?.toString() === MAX_UINT256 ? 'uint256' : 'integer');
  return {
    label: 'Amount',
    kind: 'amount',
    value: isUnlimited ? `Unlimited (${maxType} max)` : text,
    maximumAmountType: isUnlimited ? maxType : undefined,
    severity: isUnlimited ? 'high' : isZero ? 'low' : 'medium',
    explain: isUnlimited
      ? 'Unlimited amount means the spender may move the full token balance until the approval is revoked or expires.'
      : isZero
        ? 'A zero amount does not grant token spending value.'
        : 'This is the token amount or approval value embedded in the signature.',
    path,
  };
}

function maxValueForUint(type: string | undefined): bigint | undefined {
  if (!type) return undefined;
  const match = /^uint(\d*)$/.exec(type);
  if (!match) return undefined;
  const bits = match[1] ? Number(match[1]) : 256;
  if (!Number.isInteger(bits) || bits < 8 || bits > 256 || bits % 8 !== 0) return undefined;
  return 2n ** BigInt(bits) - 1n;
}

function parseUnsignedInteger(value: string): bigint | undefined {
  if (!/^(?:\d+|0x[0-9a-fA-F]+)$/.test(value)) return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function deadlineFinding(value: unknown, path: string): FieldFinding {
  const text = stringifyValue(value);
  const seconds = typeof value === 'number' && !Number.isSafeInteger(value) ? undefined : parseUnsignedInteger(text);
  if (seconds === undefined || seconds > BigInt(MAX_UINT256)) {
    return {
      label: 'Deadline',
      kind: 'deadline',
      value: text,
      severity: 'medium',
      explain: 'The deadline cannot be interpreted safely.',
      path,
    };
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  const expired = seconds < now;
  const farFuture = seconds - now > 365n * SECONDS_PER_DAY;
  const dateMs = seconds <= MAX_DATE_SECONDS ? Number(seconds * 1000n) : undefined;
  const daysRemaining = dateMs !== undefined && !expired
    ? Number((seconds - now + SECONDS_PER_DAY - 1n) / SECONDS_PER_DAY)
    : undefined;
  return {
    label: 'Deadline',
    kind: 'deadline',
    value: text,
    deadline: { dateMs, daysRemaining },
    severity: expired ? 'unknown' : farFuture ? 'medium' : 'low',
    explain: expired
      ? 'This deadline has passed, but this tool cannot verify how the receiving contract handles it.'
      : farFuture
        ? 'Long-lived signatures are riskier because they remain usable far into the future.'
        : 'The signature expires relatively soon.',
    path,
    expired,
  };
}

function asAddress(value: unknown): Address | undefined {
  return typeof value === 'string' && isAddress(value) ? value : undefined;
}

function scalarText(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : undefined;
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(stringifyValue).join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
