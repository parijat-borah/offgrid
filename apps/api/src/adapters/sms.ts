// SMS to trusted contacts when an SOS comes in. Same pattern as the OTP adapter: a MOCK for demos and
// an unconfigured real adapter, so nobody ships something that looks like it alerts people but doesn't.

export interface SmsAdapter {
  name: string;
  /** True when messages are only recorded, not delivered. The app then shows them on screen for demos. */
  demo: boolean;
  send(toE164: string, body: string): Promise<void>;
}

/** MOCK. Records and logs messages; nothing leaves the server. */
export class MockSmsAdapter implements SmsAdapter {
  name = "mock";
  demo = true;
  sent: { to: string; body: string }[] = [];
  async send(to: string, body: string) {
    this.sent.push({ to, body });
    if (process.env.NODE_ENV !== "test") console.log(`[MOCK SMS] to ${to.slice(0, 5)}…: ${body}`);
  }
}

/**
 * Real delivery needs a DLT-registered sender ID and an approved "SOS alert" template (TRAI rules) with a
 * provider such as MSG91, Exotel or Twilio, and ideally a voice-call fallback. Not wired on purpose.
 */
export class UnconfiguredSmsAdapter implements SmsAdapter {
  name = "unconfigured";
  demo = false;
  async send(): Promise<void> {
    throw new Error("SMS provider not configured. Set SMS_MODE=mock for demos, or wire a DLT-registered provider.");
  }
}

const mock = new MockSmsAdapter();
export function smsAdapterFor(mode: string): SmsAdapter {
  return mode === "mock" ? mock : new UnconfiguredSmsAdapter();
}
