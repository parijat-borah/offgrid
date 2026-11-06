import { DEFAULT_MATCH_PREFS, type CandidateDto, type MatchPrefs, type PlannerData, type TripDto } from "@offgrid/core";
import { useCallback, useEffect, useId, useState } from "react";
import { Badge, Callout } from "../../design/Badge";
import { Button } from "../../design/Button";
import { Card } from "../../design/Card";
import { Dialog } from "../../design/Dialog";
import { EmptyState, ErrorState, Skeleton } from "../../design/States";
import { api, ApiFailure, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { SPECIES_NAMES } from "../mascot/Wanderling";
import { STYLE_LABELS } from "../profile/EditProfileDialog";

const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

function PrefsDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const auth = useAuth();
  const [prefs, setPrefs] = useState<MatchPrefs>(DEFAULT_MATCH_PREFS);
  const [error, setError] = useState<string | null>(null);
  const ids = { min: useId(), max: useId() };
  const verifiedWoman = auth.me?.genderVerified && auth.me.gender === "woman";
  const genderVerified = auth.me?.genderVerified ?? false;

  useEffect(() => {
    if (open) void api<MatchPrefs>("/match/prefs").then(setPrefs).catch(() => undefined);
  }, [open]);

  const save = async () => {
    setError(null);
    try {
      await api("/match/prefs", { method: "PUT", body: prefs });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof ApiFailure ? (Object.values(e.fields)[0] ?? e.message) : errorMessage(e));
    }
  };
  const set = <K extends keyof MatchPrefs>(k: K, v: MatchPrefs[K]) => setPrefs((p) => ({ ...p, [k]: v }));
  const toggle = (k: "womenOnly" | "sameGender" | "verifiedOnly" | "visible", label: string, hint: string, disabled = false) => (
    <label className={`flex min-h-11 items-start gap-3 text-sm ${disabled ? "opacity-60" : ""}`}>
      <input type="checkbox" disabled={disabled} checked={prefs[k]} onChange={(e) => set(k, e.target.checked)} className="mt-0.5 size-5 accent-pine-700" />
      <span>
        <span className="block font-semibold">{label}</span>
        <span className="text-muted">{hint}</span>
      </span>
    </label>
  );

  return (
    <Dialog open={open} title="Who can match with you" onClose={onClose}>
      <div className="space-y-3">
        {error && <Callout tone="danger">{error}</Callout>}
        {toggle("womenOnly", "Women only", verifiedWoman ? "Only ID-verified women see you, and you see only them." : "Available to women who've verified their ID, so it can't be used to find women.", !verifiedWoman)}
        {toggle("sameGender", "Same gender only", genderVerified ? "Only people whose ID shows the same gender as yours." : "Needs ID verification.", !genderVerified)}
        {toggle("verifiedOnly", "ID-verified people only", "Hide anyone who hasn't verified a government ID.")}
        {toggle("visible", "Let others find me", "Off: you won't appear in anyone's list, though you can still send requests.")}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor={ids.min} className="mb-1 block text-sm font-semibold">
              Age from
            </label>
            <input id={ids.min} type="number" min={18} max={99} value={prefs.ageMin} onChange={(e) => set("ageMin", Math.max(18, Number(e.target.value) || 18))} className="min-h-12 w-full rounded-xl border border-line px-3" />
          </div>
          <div>
            <label htmlFor={ids.max} className="mb-1 block text-sm font-semibold">
              to
            </label>
            <input id={ids.max} type="number" min={18} max={120} value={prefs.ageMax} onChange={(e) => set("ageMax", Math.max(18, Number(e.target.value) || 120))} className="min-h-12 w-full rounded-xl border border-line px-3" />
          </div>
        </div>
        <p className="text-xs text-muted">These work both ways: someone appears only if you fit their settings too. Everyone on OFFGRID is 18+.</p>
        <Button block onClick={() => void save()}>
          Save
        </Button>
      </div>
    </Dialog>
  );
}

function RequestDialog({ candidate, fromTripId, onClose, onSent }: { candidate: CandidateDto | null; fromTripId: string; onClose: () => void; onSent: () => void }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const msgId = useId();
  const send = async () => {
    if (!candidate) return;
    setBusy(true);
    setError(null);
    try {
      await api("/match/requests", { method: "POST", body: { fromTripId, toTripId: candidate.tripId, message } });
      onSent();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={candidate !== null} title={`Travel with ${candidate?.displayName ?? ""}?`} onClose={onClose}>
      <div className="space-y-3">
        {error && <Callout tone="danger">{error}</Callout>}
        <label htmlFor={msgId} className="block text-sm font-semibold">
          Say hello (optional)
        </label>
        <textarea id={msgId} rows={3} maxLength={300} value={message} onChange={(e) => setMessage(e.target.value)} className="w-full rounded-xl border border-line p-3" placeholder="Hi! I'm doing Hampta with a 2nd-day acclimatisation stop. Want to team up for transport?" />
        <p className="text-xs text-muted">Phone numbers, emails and social handles are hidden until you're both connected and choose to share.</p>
        <Button block disabled={busy} onClick={() => void send()}>
          {busy ? "Sending…" : "Send request"}
        </Button>
      </div>
    </Dialog>
  );
}

export function BuddiesView({ data, tripId, onBack, onVerify, onQuiz, onInbox }: { data: PlannerData; tripId: string; onBack: () => void; onVerify: () => void; onQuiz: () => void; onInbox: () => void }) {
  const auth = useAuth();
  const [trip, setTrip] = useState<TripDto | null>(null);
  const [list, setList] = useState<CandidateDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [asking, setAsking] = useState<CandidateDto | null>(null);
  const [looking, setLooking] = useState(false);
  const me = auth.me;
  const phoneVerified = me?.verifications.find((v) => v.tier === "phone")?.verified ?? false;

  const load = useCallback(async () => {
    setError(null);
    try {
      const t = await api<TripDto>(`/trips/${tripId}`);
      setTrip(t);
      setLooking(t.lookingForCompanions);
      if (t.startDate && phoneVerified) setList(await api<CandidateDto[]>(`/match/candidates?tripId=${tripId}`));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [tripId, phoneVerified]);
  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorState title="Couldn't load travel buddies" detail={error} onRetry={() => void load()} />;
  if (!trip || !me) return <Skeleton className="h-60" />;

  const place = data.places.find((p) => p.id === trip.placeId);
  const setLookingFlag = async (v: boolean) => {
    try {
      await api(`/match/trips/${trip.id}/looking`, { method: "POST", body: { looking: v } });
      setLooking(v);
      void load();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const blockers: { text: string; action: () => void; label: string }[] = [];
  if (!phoneVerified) blockers.push({ text: "Verify your phone number. Only verified travellers can find each other.", action: onVerify, label: "Verify" });
  if (!trip.startDate) blockers.push({ text: "Add a start date to this trip, so buddies know when you're going.", action: onBack, label: "Add date" });

  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={onBack} className="-ml-2">
        ← Back to trip
      </Button>
      <div>
        <h1 className="text-2xl font-extrabold">Travel buddies for {place?.name ?? "this trip"}</h1>
        <p className="text-sm text-muted">
          {trip.startDate ? `Travellers heading there around ${fmtDate(trip.startDate)} who are looking for company.` : "Find people going on the same trip at the same time."} This is for
          finding travel company, not dating.
        </p>
      </div>

      {blockers.map((b) => (
        <Card key={b.text} className="flex items-center justify-between gap-3">
          <p className="text-sm">{b.text}</p>
          <Button onClick={b.action}>{b.label}</Button>
        </Card>
      ))}

      {blockers.length === 0 && (
        <>
          <Card className="space-y-2">
            <label className="flex min-h-11 items-start gap-3 text-sm">
              <input type="checkbox" checked={looking} onChange={(e) => void setLookingFlag(e.target.checked)} className="mt-0.5 size-5 accent-pine-700" />
              <span>
                <span className="block font-semibold">Let others find me for this trip</span>
                <span className="text-muted">They'll see your first name, avatar, age band, traveller type and trust. Never your contact details.</span>
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setPrefsOpen(true)}>
                ⚙ Who can match with me
              </Button>
              {!me.travellerType && (
                <Button variant="ghost" onClick={onQuiz}>
                  Take the traveller-type quiz
                </Button>
              )}
              <Button variant="ghost" onClick={onInbox}>
                💬 Requests & chats
              </Button>
            </div>
          </Card>

          {!list ? (
            <Skeleton className="h-40" />
          ) : list.length === 0 ? (
            <EmptyState icon="🧍" title="No buddies for these dates yet">
              Turn on “Let others find me” so people planning later can find you. Check back closer to your trip.
            </EmptyState>
          ) : (
            <ul className="space-y-3">
              {list.map((c) => (
                <li key={c.tripId}>
                  <Card className="space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span aria-hidden="true" className="grid size-12 place-items-center rounded-full bg-paper text-2xl">
                          {c.avatar}
                        </span>
                        <div>
                          <p className="font-bold">
                            {c.displayName} <span className="font-normal text-muted">· {c.ageBand}</span>
                          </p>
                          <p className="text-xs text-muted">
                            {c.travellerType ? `${c.travellerType.icon} ${c.travellerType.name} · ` : ""}Lv {c.level} {SPECIES_NAMES[c.mascotSpecies as keyof typeof SPECIES_NAMES] ?? ""} · {c.tripsCompleted} trips
                          </p>
                        </div>
                      </div>
                      <div className="text-center" aria-label={`Match ${c.score} out of 100`}>
                        <div className="text-lg font-extrabold text-pine-700">{c.score}</div>
                        <div aria-hidden="true" className="text-[11px] text-muted">
                          match
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {c.idVerified ? <Badge tone="good">🪪 ID Verified</Badge> : <Badge>Not ID-verified</Badge>}
                      {c.trust >= 60 && <Badge tone="good">⭐ Trusted</Badge>}
                      <Badge>Trust {c.trust}</Badge>
                      <Badge tone="accent">
                        {fmtDate(c.startDate)} · {c.days} days
                      </Badge>
                      {c.styleTags.slice(0, 3).map((t) => (
                        <Badge key={t}>{STYLE_LABELS[t as keyof typeof STYLE_LABELS] ?? t}</Badge>
                      ))}
                    </div>
                    <ul className="list-disc pl-5 text-sm">
                      {c.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                    {c.requestStatus ? (
                      <p className="text-sm font-semibold text-muted">{c.requestStatus === "pending" ? "Request sent" : c.requestStatus === "accepted" ? "Connected: see Requests & chats" : "Not available"}</p>
                    ) : (
                      <Button block onClick={() => setAsking(c)}>
                        Ask to travel together
                      </Button>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <Callout tone="warn" title="Stay safe">
        Meet first in a busy public place, tell someone your plans, keep chatting in OFFGRID until you've met, and never send money in advance. “ID Verified” is not a background check.
      </Callout>

      <PrefsDialog open={prefsOpen} onClose={() => setPrefsOpen(false)} onSaved={() => void load()} />
      <RequestDialog candidate={asking} fromTripId={trip.id} onClose={() => setAsking(null)} onSent={() => void load()} />
    </div>
  );
}
