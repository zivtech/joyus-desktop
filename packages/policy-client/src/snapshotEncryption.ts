import {
  generateKeyPairSync,
  diffieHellman,
  hkdfSync,
  createPublicKey,
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import type { KeyObject } from "node:crypto";
import { DEFAULT_CHUNK_SIZE } from "./handoffTypes";

// X25519 SPKI DER prefix (12 bytes) for wrapping raw 32-byte public keys
const X25519_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");

// HKDF parameters: Task prompt T014 specifies empty salt with "handoff-cek" info.
// research.md R1 specifies salt=sessionId with info="joyus-snapshot-v1".
// Decision: Follow task prompt. Per-session domain separation is provided by the
// ephemeral key pair (unique per handoff), so empty salt is acceptable.
// Cloud decryptor (WP08) uses the same derivation — both sides must agree.
const HKDF_INFO = Buffer.from("handoff-cek");
const HKDF_SALT = Buffer.alloc(0);
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const CHUNK_ALIGNMENT = 256 * 1024; // 256 KiB — matches snapshotAssembly

export interface EncryptedChunk {
  readonly chunkIndex: number;
  readonly iv: Buffer;
  readonly ciphertext: Buffer;
  readonly authTag: Buffer;
  readonly aad: Buffer;
}

export interface EncryptedArtifact {
  readonly artifact_id: string;
  readonly iv: Buffer;
  readonly ciphertext: Buffer;
  readonly authTag: Buffer;
}

/**
 * Generate an ephemeral X25519 key pair for ECIES key agreement.
 * Returns the raw 32-byte public key and the private KeyObject.
 *
 * Note: Uses node:crypto KeyObject (extractable) rather than WebCrypto CryptoKey
 * (non-extractable) for synchronous API simplicity. The private key is ephemeral
 * and short-lived (discarded after key agreement), mitigating extractability risk.
 */
export function generateEphemeralKeyPair(): {
  publicKey: Buffer;
  privateKey: KeyObject;
} {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const spkiDer = publicKey.export({ type: "spki", format: "der" });
  const rawPublicKey = Buffer.from(spkiDer.subarray(spkiDer.length - 32));
  return { publicKey: rawPublicKey, privateKey };
}

/**
 * Reconstruct a KeyObject from a raw 32-byte X25519 public key.
 */
function rawToPublicKeyObject(raw: Buffer): KeyObject {
  const der = Buffer.concat([X25519_SPKI_PREFIX, raw]);
  return createPublicKey({ key: der, format: "der", type: "spki" });
}

/**
 * Derive a 32-byte content encryption key (CEK) from an ECDH shared secret.
 * Uses HKDF-SHA256 with empty salt and "handoff-cek" info.
 */
export function deriveContentEncryptionKey(
  privateKey: KeyObject,
  peerPublicKey: Buffer
): Buffer {
  const peerKeyObject = rawToPublicKeyObject(peerPublicKey);
  const sharedSecret = diffieHellman({ privateKey, publicKey: peerKeyObject });
  const derived = hkdfSync(
    "sha256",
    sharedSecret,
    HKDF_SALT,
    HKDF_INFO,
    32
  );
  return Buffer.from(derived);
}

/**
 * Convenience wrapper: generate an ephemeral key pair and derive a CEK
 * against the provided cloud public key.
 */
export function performKeyAgreement(cloudPublicKey: Buffer): {
  ephemeralPublicKey: Buffer;
  contentEncryptionKey: Buffer;
} {
  const { publicKey: ephemeralPublicKey, privateKey } =
    generateEphemeralKeyPair();
  const contentEncryptionKey = deriveContentEncryptionKey(
    privateKey,
    cloudPublicKey
  );
  return { ephemeralPublicKey, contentEncryptionKey };
}

/**
 * Build the AAD (Additional Authenticated Data) for a given chunk.
 * Format: "${sessionId}:${chunkIndex}:${totalChunks}" encoded as UTF-8.
 *
 * Note: research.md R2 specifies a binary AAD format (uint32-BE for indices).
 * Task prompt T016 specifies this string format. Both desktop (WP04) and cloud
 * (WP08) use this same function, ensuring agreement on the canonical format.
 */
export function buildChunkAAD(
  sessionId: string,
  chunkIndex: number,
  totalChunks: number
): Buffer {
  return Buffer.from(`${sessionId}:${chunkIndex}:${totalChunks}`);
}

/**
 * Encrypt a single chunk with AES-256-GCM.
 */
export function encryptChunk(
  cek: Buffer,
  plaintext: Buffer,
  chunkIndex: number,
  totalChunks: number,
  sessionId: string
): EncryptedChunk {
  const iv = randomBytes(AES_GCM_IV_BYTES);
  const aad = buildChunkAAD(sessionId, chunkIndex, totalChunks);

  const cipher = createCipheriv("aes-256-gcm", cek, iv, {
    authTagLength: AES_GCM_TAG_BYTES,
  });
  cipher.setAAD(aad);

  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return { chunkIndex, iv, ciphertext: encrypted, authTag, aad };
}

/**
 * Decrypt a single chunk with AES-256-GCM.
 * Throws on authentication failure (tampered data, wrong AAD, wrong key, etc.).
 */
export function decryptChunk(cek: Buffer, chunk: EncryptedChunk): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", cek, chunk.iv, {
    authTagLength: AES_GCM_TAG_BYTES,
  });
  decipher.setAuthTag(chunk.authTag);
  decipher.setAAD(chunk.aad);

  return Buffer.concat([decipher.update(chunk.ciphertext), decipher.final()]);
}

/**
 * Align chunk size to 256 KiB boundary (matches snapshotAssembly.alignChunkSize).
 */
function alignChunkSize(requestedSize: number): number {
  const size = Math.max(requestedSize, CHUNK_ALIGNMENT);
  return Math.ceil(size / CHUNK_ALIGNMENT) * CHUNK_ALIGNMENT;
}

/**
 * Split a buffer into chunks of the given size. Last chunk may be smaller.
 * Empty data returns an empty array.
 */
export function splitIntoChunks(
  data: Buffer,
  chunkSize: number = DEFAULT_CHUNK_SIZE
): Buffer[] {
  if (data.length === 0) {
    return [];
  }

  const chunks: Buffer[] = [];
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    chunks.push(data.subarray(offset, offset + chunkSize));
  }
  return chunks;
}

/**
 * Encrypt a full snapshot: split into aligned chunks, then encrypt each.
 */
export function encryptSnapshot(
  cek: Buffer,
  snapshotData: Buffer,
  sessionId: string,
  chunkSize: number = DEFAULT_CHUNK_SIZE
): EncryptedChunk[] {
  const effectiveChunkSize = alignChunkSize(chunkSize);
  const chunks = splitIntoChunks(snapshotData, effectiveChunkSize);
  const totalChunks = chunks.length;

  return chunks.map((chunk, index) =>
    encryptChunk(cek, chunk, index, totalChunks, sessionId)
  );
}

/**
 * Encrypt an individual artifact with AES-256-GCM.
 * Uses artifact_id as AAD.
 */
export function encryptArtifact(
  cek: Buffer,
  artifactId: string,
  data: Buffer
): EncryptedArtifact {
  const iv = randomBytes(AES_GCM_IV_BYTES);
  const aad = Buffer.from(artifactId);

  const cipher = createCipheriv("aes-256-gcm", cek, iv, {
    authTagLength: AES_GCM_TAG_BYTES,
  });
  cipher.setAAD(aad);

  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return { artifact_id: artifactId, iv, ciphertext, authTag };
}

/**
 * Decrypt an individual artifact with AES-256-GCM.
 * Uses artifact_id as AAD. Throws on authentication failure.
 */
export function decryptArtifact(
  cek: Buffer,
  encrypted: EncryptedArtifact
): Buffer {
  const aad = Buffer.from(encrypted.artifact_id);

  const decipher = createDecipheriv("aes-256-gcm", cek, encrypted.iv, {
    authTagLength: AES_GCM_TAG_BYTES,
  });
  decipher.setAuthTag(encrypted.authTag);
  decipher.setAAD(aad);

  return Buffer.concat([
    decipher.update(encrypted.ciphertext),
    decipher.final(),
  ]);
}
