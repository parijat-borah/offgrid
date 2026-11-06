// Identity services: SMS/email OTP, government ID (DigiLocker) and selfie liveness.
// Every one sits behind an interface with a MOCK, so the demo runs with no contracts or keys.
// The real integrations need organisational onboarding (see docs/PRIVACY.md) and are stubs here.
import sharp from "sharp";

export interface OtpAdapter {
  name: string;
  /** True when the code is exposed to the client for demos. Never in production. */
  exposesCode: boolean;
  send(channel: "phone" | "email", target: string, code: string): Promise<void>;
}

/** MOCK. Logs the code; the API also returns it as `devCode` so the demo needs no SMS. */
export class MockOtpAdapter implements OtpAdapter {
  name = "mock";
  exposesCode = true;
  sent: { channel: string; target: string; code: string }[] = [];
  async send(channel: "phone" | "email", target: string, code: string) {
    this.sent.push({ channel, target, code });
    if (process.env.NODE_ENV !== "test") console.log(`[MOCK OTP] ${channel} ${target.slice(0, 4)}… code ${code}`);
  }
}

/**
 * Real SMS needs a DLT-registered sender ID and template (TRAI rules) with a provider such as
 * MSG91 or Twilio Verify. Left unconfigured on purpose so nobody ships a fake "real" adapter.
 */
export class UnconfiguredOtpAdapter implements OtpAdapter {
  name = "unconfigured";
  exposesCode = false;
  async send(): Promise<void> {
    throw new Error("OTP provider not configured. Set OTP_MODE=mock for demos, or wire MSG91/Twilio with a DLT template.");
  }
}

export interface KycIdentity {
  /** Used only to check the ID belongs to this account holder; never stored. */
  name: string;
  /** DigiLocker returns M / F / T, mapped here. */
  gender: "man" | "woman" | "nonbinary";
  yearOfBirth: number;
  docType: "aadhaar" | "driving_licence" | "pan";
  /** Last 4 characters of the document number, for display only. */
  last4: string;
}

export interface KycAdapter {
  name: string;
  simulated: boolean;
  /** Where to send the user to grant consent. `state` protects against CSRF and replay. */
  authorizeUrl(state: string): string;
  /** Turn the code from the consent redirect into verified identity details. */
  exchange(code: string): Promise<KycIdentity>;
}

/**
 * MOCK DigiLocker. Our web app shows a clearly labelled "simulated DigiLocker" consent screen
 * and posts back a code that carries the details the tester chose. It verifies nothing.
 */
export class MockKycAdapter implements KycAdapter {
  name = "digilocker-mock";
  simulated = true;
  authorizeUrl(state: string) {
    return `/?view=kyc-consent&state=${encodeURIComponent(state)}`;
  }
  async exchange(code: string): Promise<KycIdentity> {
    let raw: unknown;
    try {
      raw = JSON.parse(Buffer.from(code, "base64url").toString("utf8"));
    } catch {
      throw new Error("Invalid consent code");
    }
    const r = raw as Partial<KycIdentity> & { approved?: boolean };
    if (!r.approved) throw new Error("Consent was declined");
    const gender = r.gender === "woman" || r.gender === "man" || r.gender === "nonbinary" ? r.gender : null;
    if (!r.name || !gender || typeof r.yearOfBirth !== "number") throw new Error("Incomplete identity");
    return { name: r.name, gender, yearOfBirth: r.yearOfBirth, docType: "aadhaar", last4: String(Math.floor(1000 + Math.random() * 9000)) };
  }
}

/**
 * Real path: DigiLocker "Requester" API (OAuth 2.0 + PKCE) via MeriPehchaan. The user consents in
 * DigiLocker, we receive a code, exchange it for a token and fetch the e-Aadhaar XML or driving-licence
 * data. Only the fields above are kept. Requires partner onboarding, so it's not wired up here.
 */
export class UnconfiguredKycAdapter implements KycAdapter {
  name = "digilocker";
  simulated = false;
  authorizeUrl(): string {
    throw new Error("DigiLocker partner credentials not configured. Set KYC_MODE=mock for demos.");
  }
  async exchange(): Promise<KycIdentity> {
    throw new Error("DigiLocker partner credentials not configured.");
  }
}

export interface LivenessAdapter {
  name: string;
  simulated: boolean;
  /** The image is checked in memory and never written to disk or the database. */
  check(image: Buffer): Promise<{ passed: boolean; reason: string | null }>;
}

/**
 * MOCK. Only confirms the upload is a real, reasonably sized photo. A real vendor
 * (e.g. HyperVerge, IDfy) also checks it's a live face and matches the ID photo.
 */
export class MockLivenessAdapter implements LivenessAdapter {
  name = "liveness-mock";
  simulated = true;
  async check(image: Buffer) {
    try {
      const meta = await sharp(image).metadata();
      if (!meta.width || !meta.height || Math.min(meta.width, meta.height) < 200) return { passed: false, reason: "The photo is too small. Use the front camera in good light." };
      return { passed: true, reason: null };
    } catch {
      return { passed: false, reason: "That file isn't a photo." };
    }
  }
}

export class UnconfiguredLivenessAdapter implements LivenessAdapter {
  name = "liveness";
  simulated = false;
  async check(): Promise<{ passed: boolean; reason: string | null }> {
    throw new Error("Liveness vendor not configured. Set LIVENESS_MODE=mock for demos.");
  }
}

export interface IdentityAdapters {
  otp: OtpAdapter;
  kyc: KycAdapter;
  liveness: LivenessAdapter;
}

export function identityAdaptersFor(modes: { otp: string; kyc: string; liveness: string }): IdentityAdapters {
  return {
    otp: modes.otp === "mock" ? new MockOtpAdapter() : new UnconfiguredOtpAdapter(),
    kyc: modes.kyc === "mock" ? new MockKycAdapter() : new UnconfiguredKycAdapter(),
    liveness: modes.liveness === "mock" ? new MockLivenessAdapter() : new UnconfiguredLivenessAdapter(),
  };
}
