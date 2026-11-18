import { afterEach, describe, expect, it, vi } from "vitest";
import { readLiveConfig } from "../firebaseAdapter";

describe("readLiveConfig storage bucket", () => {
  afterEach(() => vi.unstubAllEnvs());

  function stub(bucket?: string) {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_API_KEY", "k");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "demo-proj");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_APP_ID", "1:1:web:1");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", bucket ?? "");
  }

  it("defaults the default bucket from the project id so Storage reads work", () => {
    stub();
    expect(readLiveConfig()?.firebase.storageBucket).toBe("demo-proj.firebasestorage.app");
  });

  it("uses the configured bucket when provided", () => {
    stub("custom-bucket");
    expect(readLiveConfig()?.firebase.storageBucket).toBe("custom-bucket");
  });
});
