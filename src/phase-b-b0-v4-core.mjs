import crypto from 'node:crypto';

const MASK64 = (1n << 64n) - 1n;
const UINT64_RANGE = 1n << 64n;

function normalize(value) {
  if (typeof value === 'string') return value.normalize('NFC');
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('jcs_nonfinite_number');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === 'bigint' || value === undefined || typeof value === 'function') throw new TypeError('jcs_forbidden_type');
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    if (value instanceof Date) throw new TypeError('jcs_undeclared_date');
    const output = {};
    for (const key of Object.keys(value).map((key) => key.normalize('NFC')).sort()) {
      const sourceKey = Object.keys(value).find((candidate) => candidate.normalize('NFC') === key);
      if (Object.hasOwn(output, key)) throw new TypeError('jcs_nfc_key_collision');
      output[key] = normalize(value[sourceKey]);
    }
    return output;
  }
  return value;
}

export function jcsNfc(value) {
  return JSON.stringify(normalize(value));
}

export function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function seedDigest(seedMaterial) {
  return crypto.createHash('sha256').update(Buffer.from(jcsNfc(seedMaterial), 'utf8')).digest();
}

function rotl(value, bits) {
  const k = BigInt(bits);
  return ((value << k) | (value >> (64n - k))) & MASK64;
}

export class Xoshiro256StarStarV1 {
  constructor(digest) {
    if (!Buffer.isBuffer(digest) || digest.length !== 32) throw new TypeError('xoshiro_digest_must_be_32_bytes');
    this.state = [0, 8, 16, 24].map((offset) => digest.readBigUInt64BE(offset));
    if (this.state.every((value) => value === 0n)) this.state[0] = 0x9E3779B97F4A7C15n;
  }

  nextUint64() {
    const [s0, s1, s2, s3] = this.state;
    const result = (rotl((s1 * 5n) & MASK64, 7) * 9n) & MASK64;
    const t = (s1 << 17n) & MASK64;
    let n2 = s2 ^ s0;
    let n3 = s3 ^ s1;
    let n1 = s1 ^ n2;
    let n0 = s0 ^ n3;
    n2 ^= t;
    n3 = rotl(n3, 45);
    this.state = [n0 & MASK64, n1 & MASK64, n2 & MASK64, n3 & MASK64];
    return result;
  }

  uniform01() {
    return Number(this.nextUint64() >> 11n) / 9007199254740992;
  }

  drawIndex(n) {
    if (!Number.isSafeInteger(n) || n <= 0) throw new RangeError('draw_index_n_must_be_positive_safe_integer');
    const divisor = BigInt(n);
    const limit = UINT64_RANGE - (UINT64_RANGE % divisor);
    while (true) {
      const value = this.nextUint64();
      if (value < limit) return Number(value % divisor);
    }
  }
}

export function rngFromSeedMaterial(seedMaterial) {
  const digest = seedDigest(seedMaterial);
  return { rng: new Xoshiro256StarStarV1(digest), seedHash: digest.toString('hex') };
}

export function fisherYates(values, rng) {
  const output = [...values];
  for (let index = output.length - 1; index >= 1; index -= 1) {
    const selected = rng.drawIndex(index + 1);
    [output[index], output[selected]] = [output[selected], output[index]];
  }
  return output;
}

export function typedAvailable(value) {
  if (!Number.isFinite(value)) throw new TypeError('available_value_must_be_finite');
  return { state: 'AVAILABLE', value: Object.is(value, -0) ? 0 : value, reasonCode: null };
}

export function typedUnavailable(reasonCode) {
  if (typeof reasonCode !== 'string' || !reasonCode.length) throw new TypeError('unavailable_reason_required');
  return { state: 'UNAVAILABLE', value: null, reasonCode };
}

export function validateTypedNumber(value) {
  if (!value || typeof value !== 'object' || !Object.hasOwn(value, 'state') || !Object.hasOwn(value, 'value') || !Object.hasOwn(value, 'reasonCode')) return false;
  if (value.state === 'AVAILABLE') return Number.isFinite(value.value) && value.reasonCode === null;
  if (value.state === 'UNAVAILABLE') return value.value === null && typeof value.reasonCode === 'string' && value.reasonCode.length > 0;
  return false;
}

export function makeSeedMaterial({ freezeHash, purpose, foldId = null, endpointId = null, blockLength = null, replicateIndex = null, featureId = null, streamId }) {
  return {
    schemaVersion: 'B0_RNG_SEED_V1', seedBase: 20260730,
    preregistrationFreezeHash: freezeHash,
    baselineFreezeHash: '9664ca8777cfdf827e6383b952ac006f7577f59c0abe86e7182d44e8dd2451cf',
    candidateId: 'F3C02', purpose, foldId, endpointId, blockLength, replicateIndex, featureId, streamId,
  };
}

