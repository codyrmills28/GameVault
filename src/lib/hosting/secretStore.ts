import crypto from "crypto";
import fs from "fs";
import path from "path";
import { dataRoot } from "@/lib/appPaths";

// Electron's safeStorage is only a real API when running inside the Electron
// main process. Outside it (dev `next`, vitest), require("electron") returns the
// path string to the binary, so `safeStorage` is undefined and we fall back to
// AES with a locally persisted key.
function getSafeStorage(): { isEncryptionAvailable(): boolean; encryptString(s: string): Buffer; decryptString(b: Buffer): string } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require("electron");
    const ss = electron && electron.safeStorage;
    if (ss && typeof ss.isEncryptionAvailable === "function" && ss.isEncryptionAvailable()) {
      return ss;
    }
  } catch {
    /* not in Electron */
  }
  return null;
}

function keyPath(): string {
  return path.join(dataRoot(), ".secret.key");
}

function getOrCreateAesKey(): Buffer {
  const p = keyPath();
  if (fs.existsSync(p)) {
    return fs.readFileSync(p);
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(p, key, { mode: 0o600 });
  return key;
}

export function encryptSecret(plain: string): string {
  const ss = getSafeStorage();
  if (ss) {
    return "v1:safe:" + ss.encryptString(plain).toString("base64");
  }
  const key = getOrCreateAesKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return "v1:aes:" + Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptSecret(blob: string): string {
  if (blob.startsWith("v1:safe:")) {
    const ss = getSafeStorage();
    if (!ss) throw new Error("safeStorage unavailable to decrypt this secret");
    return ss.decryptString(Buffer.from(blob.slice("v1:safe:".length), "base64"));
  }
  if (blob.startsWith("v1:aes:")) {
    const raw = Buffer.from(blob.slice("v1:aes:".length), "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const key = getOrCreateAesKey();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  }
  throw new Error("Unrecognized secret blob format");
}
