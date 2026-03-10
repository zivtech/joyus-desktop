import { describe, it, expect } from "vitest";
import {
  generateEphemeralKeyPair,
  deriveContentEncryptionKey,
  performKeyAgreement,
  buildChunkAAD,
  encryptChunk,
  decryptChunk,
  splitIntoChunks,
  encryptSnapshot,
  encryptArtifact,
  decryptArtifact,
} from "../src/snapshotEncryption";
import type { EncryptedChunk } from "../src/snapshotEncryption";
import { DEFAULT_CHUNK_SIZE } from "../src/handoffTypes";

describe("generateEphemeralKeyPair", () => {
  it("returns a 32-byte public key", () => {
    const { publicKey } = generateEphemeralKeyPair();
    expect(publicKey).toBeInstanceOf(Buffer);
    expect(publicKey.length).toBe(32);
  });

  it("returns a KeyObject as privateKey", () => {
    const { privateKey } = generateEphemeralKeyPair();
    expect(privateKey.type).toBe("private");
    expect(privateKey.asymmetricKeyType).toBe("x25519");
  });

  it("generates unique key pairs on each call", () => {
    const kp1 = generateEphemeralKeyPair();
    const kp2 = generateEphemeralKeyPair();
    expect(kp1.publicKey.equals(kp2.publicKey)).toBe(false);
  });
});

describe("deriveContentEncryptionKey", () => {
  it("derives the same CEK from both sides of an ECDH exchange", () => {
    const alice = generateEphemeralKeyPair();
    const bob = generateEphemeralKeyPair();

    const cekAlice = deriveContentEncryptionKey(alice.privateKey, bob.publicKey);
    const cekBob = deriveContentEncryptionKey(bob.privateKey, alice.publicKey);

    expect(cekAlice).toBeInstanceOf(Buffer);
    expect(cekAlice.length).toBe(32);
    expect(cekAlice.equals(cekBob)).toBe(true);
  });

  it("derives different CEKs for different peer public keys", () => {
    const alice = generateEphemeralKeyPair();
    const bob = generateEphemeralKeyPair();
    const charlie = generateEphemeralKeyPair();

    const cek1 = deriveContentEncryptionKey(alice.privateKey, bob.publicKey);
    const cek2 = deriveContentEncryptionKey(alice.privateKey, charlie.publicKey);

    expect(cek1.equals(cek2)).toBe(false);
  });
});

describe("performKeyAgreement", () => {
  it("returns a 32-byte ephemeral public key", () => {
    const cloud = generateEphemeralKeyPair();
    const result = performKeyAgreement(cloud.publicKey);
    expect(result.ephemeralPublicKey).toBeInstanceOf(Buffer);
    expect(result.ephemeralPublicKey.length).toBe(32);
  });

  it("returns a 32-byte content encryption key", () => {
    const cloud = generateEphemeralKeyPair();
    const result = performKeyAgreement(cloud.publicKey);
    expect(result.contentEncryptionKey).toBeInstanceOf(Buffer);
    expect(result.contentEncryptionKey.length).toBe(32);
  });

  it("CEK can be reproduced by cloud using the ephemeral public key", () => {
    const cloud = generateEphemeralKeyPair();
    const { ephemeralPublicKey, contentEncryptionKey } = performKeyAgreement(
      cloud.publicKey
    );

    const cloudCek = deriveContentEncryptionKey(
      cloud.privateKey,
      ephemeralPublicKey
    );
    expect(contentEncryptionKey.equals(cloudCek)).toBe(true);
  });
});

describe("buildChunkAAD", () => {
  it("returns the expected UTF-8 format", () => {
    const aad = buildChunkAAD("session-123", 0, 5);
    expect(aad.toString("utf-8")).toBe("session-123:0:5");
  });

  it("encodes different indices correctly", () => {
    const aad = buildChunkAAD("s1", 3, 10);
    expect(aad.toString("utf-8")).toBe("s1:3:10");
  });

  it("returns a Buffer", () => {
    const aad = buildChunkAAD("s", 0, 1);
    expect(aad).toBeInstanceOf(Buffer);
  });
});

describe("encryptChunk / decryptChunk", () => {
  const cek = Buffer.alloc(32, 0xab); // deterministic test key
  const plaintext = Buffer.from("Hello, encrypted chunk!");
  const sessionId = "session-test-001";

  it("round-trips: encrypt then decrypt returns original plaintext", () => {
    const encrypted = encryptChunk(cek, plaintext, 0, 1, sessionId);
    const decrypted = decryptChunk(cek, encrypted);
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it("encrypted chunk has correct chunkIndex", () => {
    const encrypted = encryptChunk(cek, plaintext, 7, 10, sessionId);
    expect(encrypted.chunkIndex).toBe(7);
  });

  it("encrypted chunk has a 12-byte IV", () => {
    const encrypted = encryptChunk(cek, plaintext, 0, 1, sessionId);
    expect(encrypted.iv.length).toBe(12);
  });

  it("encrypted chunk has a 16-byte authTag", () => {
    const encrypted = encryptChunk(cek, plaintext, 0, 1, sessionId);
    expect(encrypted.authTag.length).toBe(16);
  });

  it("encrypted chunk has the expected AAD", () => {
    const encrypted = encryptChunk(cek, plaintext, 2, 5, sessionId);
    expect(encrypted.aad.toString("utf-8")).toBe(`${sessionId}:2:5`);
  });

  it("different chunks get different IVs", () => {
    const enc1 = encryptChunk(cek, plaintext, 0, 2, sessionId);
    const enc2 = encryptChunk(cek, plaintext, 1, 2, sessionId);
    expect(enc1.iv.equals(enc2.iv)).toBe(false);
  });

  it("throws on tampered ciphertext", () => {
    const encrypted = encryptChunk(cek, plaintext, 0, 1, sessionId);
    const tampered: EncryptedChunk = {
      ...encrypted,
      ciphertext: Buffer.concat([
        Buffer.from([encrypted.ciphertext[0]! ^ 0xff]),
        encrypted.ciphertext.subarray(1),
      ]),
    };
    expect(() => decryptChunk(cek, tampered)).toThrow();
  });

  it("throws on tampered authTag", () => {
    const encrypted = encryptChunk(cek, plaintext, 0, 1, sessionId);
    const tampered: EncryptedChunk = {
      ...encrypted,
      authTag: Buffer.concat([
        Buffer.from([encrypted.authTag[0]! ^ 0xff]),
        encrypted.authTag.subarray(1),
      ]),
    };
    expect(() => decryptChunk(cek, tampered)).toThrow();
  });

  it("throws on modified IV", () => {
    const encrypted = encryptChunk(cek, plaintext, 0, 1, sessionId);
    const tampered: EncryptedChunk = {
      ...encrypted,
      iv: Buffer.concat([
        Buffer.from([encrypted.iv[0]! ^ 0xff]),
        encrypted.iv.subarray(1),
      ]),
    };
    expect(() => decryptChunk(cek, tampered)).toThrow();
  });

  it("throws when chunk AAD is reordered (swapped index)", () => {
    const enc0 = encryptChunk(cek, Buffer.from("chunk zero"), 0, 2, sessionId);
    const enc1 = encryptChunk(cek, Buffer.from("chunk one"), 1, 2, sessionId);

    // Try decrypting chunk 0's ciphertext with chunk 1's AAD
    const swapped: EncryptedChunk = {
      ...enc0,
      aad: enc1.aad,
    };
    expect(() => decryptChunk(cek, swapped)).toThrow();
  });

  it("throws with wrong CEK", () => {
    const encrypted = encryptChunk(cek, plaintext, 0, 1, sessionId);
    const wrongCek = Buffer.alloc(32, 0xcd);
    expect(() => decryptChunk(wrongCek, encrypted)).toThrow();
  });
});

describe("splitIntoChunks", () => {
  it("returns empty array for empty data", () => {
    const chunks = splitIntoChunks(Buffer.alloc(0));
    expect(chunks).toEqual([]);
  });

  it("returns 1 chunk when data is smaller than chunkSize", () => {
    const data = Buffer.from("small");
    const chunks = splitIntoChunks(data, 1024);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.equals(data)).toBe(true);
  });

  it("returns 1 chunk when data equals chunkSize", () => {
    const data = Buffer.alloc(1024, 0xaa);
    const chunks = splitIntoChunks(data, 1024);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.equals(data)).toBe(true);
  });

  it("returns 2 chunks when data is slightly over chunkSize", () => {
    const data = Buffer.alloc(1025, 0xbb);
    const chunks = splitIntoChunks(data, 1024);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.length).toBe(1024);
    expect(chunks[1]!.length).toBe(1);
    expect(Buffer.concat(chunks).equals(data)).toBe(true);
  });

  it("handles exact multiples of chunkSize", () => {
    const data = Buffer.alloc(3072, 0xcc);
    const chunks = splitIntoChunks(data, 1024);
    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) {
      expect(chunk.length).toBe(1024);
    }
    expect(Buffer.concat(chunks).equals(data)).toBe(true);
  });

  it("uses DEFAULT_CHUNK_SIZE when no chunkSize given", () => {
    const data = Buffer.alloc(100);
    const chunks = splitIntoChunks(data);
    expect(chunks).toHaveLength(1);
    // Confirms default was used (data is smaller than DEFAULT_CHUNK_SIZE)
    expect(chunks[0]!.length).toBe(100);
  });
});

describe("encryptSnapshot", () => {
  const cek = Buffer.alloc(32, 0xde);
  const sessionId = "session-snap-001";

  it("encrypts and decrypts a full snapshot round-trip", () => {
    const original = Buffer.from(
      JSON.stringify({
        snapshot_id: "snap-1",
        data: "test payload with enough content to verify encryption",
      })
    );

    const encrypted = encryptSnapshot(cek, original, sessionId);
    expect(encrypted.length).toBeGreaterThan(0);

    // Decrypt all chunks and reassemble
    const decryptedParts = encrypted.map((chunk) => decryptChunk(cek, chunk));
    const reassembled = Buffer.concat(decryptedParts);
    expect(reassembled.equals(original)).toBe(true);
  });

  it("produces multiple chunks when data exceeds chunk size", () => {
    // Use minimum chunk alignment (256 KiB)
    const chunkSize = 256 * 1024;
    const data = Buffer.alloc(chunkSize + 100, 0xfa);
    const encrypted = encryptSnapshot(cek, data, sessionId, chunkSize);
    expect(encrypted).toHaveLength(2);
  });

  it("returns empty array for empty data", () => {
    const encrypted = encryptSnapshot(cek, Buffer.alloc(0), sessionId);
    expect(encrypted).toHaveLength(0);
  });

  it("aligns chunk size to 256 KiB boundary", () => {
    // Request 100 bytes; should be aligned up to 256 KiB
    const data = Buffer.alloc(512 * 1024, 0x11); // 512 KiB of data
    const encrypted = encryptSnapshot(cek, data, sessionId, 100);
    // With 256 KiB chunks, 512 KiB data => 2 chunks
    expect(encrypted).toHaveLength(2);
  });

  it("each chunk has sequential chunkIndex", () => {
    const data = Buffer.alloc(256 * 1024 * 3 + 1, 0x22); // just over 3 chunks
    const encrypted = encryptSnapshot(cek, data, sessionId, 256 * 1024);
    expect(encrypted).toHaveLength(4);
    for (let i = 0; i < encrypted.length; i++) {
      expect(encrypted[i]!.chunkIndex).toBe(i);
    }
  });

  it("each chunk AAD reflects correct totalChunks", () => {
    const data = Buffer.alloc(256 * 1024 * 2, 0x33);
    const encrypted = encryptSnapshot(cek, data, sessionId, 256 * 1024);
    expect(encrypted).toHaveLength(2);
    for (const chunk of encrypted) {
      expect(chunk.aad.toString("utf-8")).toContain(`:${encrypted.length}`);
    }
  });

  it("uses default chunk size when not specified", () => {
    const data = Buffer.alloc(100);
    const encrypted = encryptSnapshot(cek, data, sessionId);
    // Small data with default (5 MiB aligned) chunk size => 1 chunk
    expect(encrypted).toHaveLength(1);
  });
});

describe("encryptArtifact / decryptArtifact", () => {
  const cek = Buffer.alloc(32, 0xef);
  const artifactId = "artifact-test-001";
  const data = Buffer.from("artifact content for testing");

  it("round-trips: encrypt then decrypt returns original data", () => {
    const encrypted = encryptArtifact(cek, artifactId, data);
    const decrypted = decryptArtifact(cek, encrypted);
    expect(decrypted.equals(data)).toBe(true);
  });

  it("sets artifact_id on the encrypted artifact", () => {
    const encrypted = encryptArtifact(cek, artifactId, data);
    expect(encrypted.artifact_id).toBe(artifactId);
  });

  it("has a 12-byte IV", () => {
    const encrypted = encryptArtifact(cek, artifactId, data);
    expect(encrypted.iv.length).toBe(12);
  });

  it("has a 16-byte authTag", () => {
    const encrypted = encryptArtifact(cek, artifactId, data);
    expect(encrypted.authTag.length).toBe(16);
  });

  it("throws on tampered ciphertext", () => {
    const encrypted = encryptArtifact(cek, artifactId, data);
    const tampered = {
      ...encrypted,
      ciphertext: Buffer.concat([
        Buffer.from([encrypted.ciphertext[0]! ^ 0xff]),
        encrypted.ciphertext.subarray(1),
      ]),
    };
    expect(() => decryptArtifact(cek, tampered)).toThrow();
  });

  it("throws with wrong artifact_id AAD", () => {
    const encrypted = encryptArtifact(cek, artifactId, data);
    const tampered = {
      ...encrypted,
      artifact_id: "wrong-artifact-id",
    };
    expect(() => decryptArtifact(cek, tampered)).toThrow();
  });

  it("throws with wrong CEK", () => {
    const encrypted = encryptArtifact(cek, artifactId, data);
    const wrongCek = Buffer.alloc(32, 0x00);
    expect(() => decryptArtifact(wrongCek, encrypted)).toThrow();
  });
});
