import { applicationDefault, type Credential } from "firebase-admin/app";
import { defaultAdminApp } from "../../accounts/transport/resolveMembershipV1";
import { PlacesUnavailableError } from "../application/ports";
import type { TokenSource } from "./googlePlaces";

/** Refresh this long before the token expires. */
const SKEW_MS = 60_000;

/**
 * Access tokens for the Places API from the credential firebase-admin already holds (the Functions service account), so no
 * new dependency and no API key. Cached per instance until shortly before expiry; concurrent callers share one refresh.
 */
export class CredentialTokenSource implements TokenSource {
  private cached: { token: string; expiresAt: number } | null = null;
  private pending: Promise<string> | null = null;
  constructor(private readonly credential: () => Credential, private readonly now: () => number = Date.now) {}

  async getToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt - SKEW_MS > this.now()) return this.cached.token;
    this.pending ??= this.refresh().finally(() => { this.pending = null; });
    return this.pending;
  }

  private async refresh(): Promise<string> {
    try {
      const result = await this.credential().getAccessToken();
      if (!result.access_token) throw new Error("empty");
      this.cached = { token: result.access_token, expiresAt: this.now() + result.expires_in * 1000 };
      return result.access_token;
    } catch {
      throw new PlacesUnavailableError("auth");
    }
  }
}

/** The billing/quota project: the Functions runtime sets GCLOUD_PROJECT or GOOGLE_CLOUD_PROJECT. */
export function projectIdFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const id = (env.GCLOUD_PROJECT ?? env.GOOGLE_CLOUD_PROJECT)?.trim();
  return id ? id : undefined;
}

export function defaultCredential(): Credential {
  return defaultAdminApp().options.credential ?? applicationDefault();
}
