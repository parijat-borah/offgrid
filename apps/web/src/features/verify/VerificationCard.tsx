import type { KycStartResponse, Me, OtpSendResponse, VerificationTier } from "@offgrid/core";
import { useId, useState } from "react";
import { Badge, Callout } from "../../design/Badge";
import { Button } from "../../design/Button";
import { Card, SectionTitle } from "../../design/Card";
import { Dialog } from "../../design/Dialog";
import { api, ApiFailure, errorMessage, upload } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { shrinkImage } from "../../lib/image";

const TIER_LABEL: Record<VerificationTier, { label: string; why: string }> = {
  phone: { label: "Phone number", why: "Needed to find travel buddies. Never shown unless you choose to share it." },
  email: { label: "Email", why: "So we can reach you about your account." },
  gov_id: { label: "Government ID (DigiLocker)", why: "Shows an “ID Verified” badge and unlocks women-only matching." },
  liveness: { label: "Selfie check", why: "Confirms you're the person on the ID." },
};

const input = "min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-base tracking-wide";

function OtpDialog({ channel, open, onClose }: { channel: "phone" | "email"; open: boolean; onClose: () => void }) {
  const auth = useAuth();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<OtpSendResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = { phone: useId(), code: useId() };

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      setSent(await api<OtpSendResponse>(`/verification/${channel}/send`, { method: "POST", body: channel === "phone" ? { phone } : undefined }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      auth.setMe(await api<Me>(`/verification/${channel}/verify`, { method: "POST", body: { code } }));
      onClose();
    } catch (e) {
      setError(e instanceof ApiFailure && e.fields.code ? e.fields.code : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} title={channel === "phone" ? "Verify your phone" : "Verify your email"} onClose={onClose}>
      <div className="space-y-3">
        {error && <Callout tone="danger">{error}</Callout>}
        {!sent ? (
          <>
            {channel === "phone" ? (
              <div>
                <label htmlFor={ids.phone} className="mb-1 block text-sm font-semibold">
                  Indian mobile number
                </label>
                <input id={ids.phone} type="tel" inputMode="tel" autoComplete="tel-national" className={input} placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} />
                <p className="mt-1 text-xs text-muted">Stored encrypted. Travel buddies see it only if you both tap “Share contact”.</p>
              </div>
            ) : (
              <p className="text-sm">We'll send a 6-digit code to {auth.me?.email}.</p>
            )}
            <Button block onClick={() => void send()} disabled={busy || (channel === "phone" && phone.replace(/\D/g, "").length < 10)}>
              {busy ? "Sending…" : "Send code"}
            </Button>
          </>
        ) : (
          <>
            {sent.devCode && (
              <Callout tone="warn" title="Demo mode (no real SMS)">
                Your code is <span className="font-mono font-bold">{sent.devCode}</span>. In production it arrives by {channel === "phone" ? "SMS" : "email"}.
              </Callout>
            )}
            <div>
              <label htmlFor={ids.code} className="mb-1 block text-sm font-semibold">
                6-digit code
              </label>
              <input id={ids.code} inputMode="numeric" autoComplete="one-time-code" maxLength={6} className={`${input} font-mono text-lg`} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            </div>
            <Button block onClick={() => void verify()} disabled={busy || code.length !== 6}>
              {busy ? "Checking…" : "Verify"}
            </Button>
            <Button variant="ghost" block onClick={() => setSent(null)}>
              Send a new code
            </Button>
          </>
        )}
      </div>
    </Dialog>
  );
}

function KycConsentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<KycStartResponse>("/verification/kyc/start", { method: "POST", body: { consent: true } });
      window.location.assign(res.url);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} title="Verify your ID with DigiLocker" onClose={onClose}>
      <div className="space-y-3 text-sm">
        {error && <Callout tone="danger">{error}</Callout>}
        <p>You'll approve sharing in DigiLocker (the Government of India's document wallet). We never see your password or the document itself.</p>
        <div className="rounded-xl bg-paper p-3">
          <p className="font-semibold">We keep only:</p>
          <ul className="mt-1 list-disc pl-5">
            <li>The document type and its last 4 characters (for example “Aadhaar ••1234”)</li>
            <li>Your gender, to protect women-only matching</li>
          </ul>
          <p className="mt-2 font-semibold">We check, then discard:</p>
          <ul className="mt-1 list-disc pl-5">
            <li>Your year of birth (it must match your profile)</li>
            <li>Your name. The full ID number and photo are never received.</li>
          </ul>
        </div>
        <p className="text-xs text-muted">
          “ID Verified” means this person proved who they are. It is not a background or criminal-record check. You can withdraw consent at any time, which removes the verification (DPDP Act 2023).
        </p>
        <label className="flex min-h-11 items-start gap-3">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 size-5 accent-pine-700" />
          <span>I agree to share these details for identity verification.</span>
        </label>
        <Button block disabled={!agree || busy} onClick={() => void start()}>
          {busy ? "Opening DigiLocker…" : "Continue to DigiLocker"}
        </Button>
      </div>
    </Dialog>
  );
}

export function VerificationCard() {
  const auth = useAuth();
  const [dialog, setDialog] = useState<"phone" | "email" | "kyc" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selfieId = useId();
  const me = auth.me!;
  const has = (t: VerificationTier) => me.verifications.find((v) => v.tier === t)?.verified ?? false;

  const selfie = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("selfie", await shrinkImage(file, 1024), "selfie.jpg");
      auth.setMe(await upload<Me>("/verification/liveness", form));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (!confirm("Remove your ID verification? Your “ID Verified” badge and women-only matching will switch off.")) return;
    try {
      auth.setMe(await api<Me>("/verification/kyc", { method: "DELETE" }));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Card className="space-y-3">
      <SectionTitle hint="Verification builds trust with travel buddies. Each step is optional.">Verification & trust</SectionTitle>
      <div className="flex items-center gap-3">
        <div className="grid size-14 place-items-center rounded-full border-4 border-pine-600 text-lg font-extrabold text-pine-700" aria-label={`Trust score ${me.trust} out of 100`}>
          {me.trust}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {has("gov_id") && <Badge tone="good">🪪 ID Verified</Badge>}
          {me.trust >= 60 && <Badge tone="good">⭐ Trusted Traveller</Badge>}
          {!has("gov_id") && me.trust < 60 && <span className="text-sm text-muted">Trust score out of 100</span>}
        </div>
      </div>
      {error && <Callout tone="danger">{error}</Callout>}

      <ul className="divide-y divide-line">
        {me.verifications.map((v) => (
          <li key={v.tier} className="flex items-center justify-between gap-3 py-2.5">
            <span className="min-w-0 text-sm">
              <span className="block font-semibold">
                {v.verified ? "✅" : "⬜"} {TIER_LABEL[v.tier].label}
              </span>
              <span className="text-xs text-muted">{v.verified ? v.detail : TIER_LABEL[v.tier].why}</span>
            </span>
            {!v.verified && v.tier === "phone" && <Button onClick={() => setDialog("phone")}>Verify</Button>}
            {!v.verified && v.tier === "email" && <Button variant="secondary" onClick={() => setDialog("email")}>Verify</Button>}
            {!v.verified && v.tier === "gov_id" && (
              <Button variant="secondary" disabled={!has("phone")} onClick={() => setDialog("kyc")} title={has("phone") ? undefined : "Verify your phone first"}>
                Verify
              </Button>
            )}
            {!v.verified && v.tier === "liveness" && (
              <label htmlFor={selfieId} className={`inline-flex min-h-11 items-center rounded-xl border border-line px-4 text-sm font-semibold ${has("gov_id") && !busy ? "cursor-pointer text-pine-700 hover:bg-pine-50" : "pointer-events-none opacity-50"}`}>
                {busy ? "Checking…" : "Take selfie"}
                <input id={selfieId} type="file" accept="image/*" capture="user" className="sr-only" disabled={!has("gov_id") || busy} onChange={(e) => void selfie(e.target.files?.[0])} />
              </label>
            )}
            {v.verified && v.tier === "gov_id" && (
              <Button variant="ghost" onClick={() => void withdraw()}>
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>

      <details className="text-sm">
        <summary className="min-h-8 cursor-pointer font-semibold">How is my trust score worked out?</summary>
        <ul className="mt-2 space-y-1">
          {me.trustParts.map((p) => (
            <li key={p.label} className="flex justify-between gap-2">
              <span>{p.label}</span>
              <span className={`tabular-nums ${p.points < 0 ? "text-danger-700" : p.points > 0 ? "text-pine-700" : "text-muted"}`}>
                {p.points > 0 ? "+" : ""}
                {p.points}
                {p.max > 0 ? ` / ${p.max}` : ""}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">Selfie checks and DigiLocker run in demo (simulated) mode in this build.</p>
      </details>

      <OtpDialog key={`phone-${dialog === "phone"}`} channel="phone" open={dialog === "phone"} onClose={() => setDialog(null)} />
      <OtpDialog key={`email-${dialog === "email"}`} channel="email" open={dialog === "email"} onClose={() => setDialog(null)} />
      <KycConsentDialog open={dialog === "kyc"} onClose={() => setDialog(null)} />
    </Card>
  );
}
