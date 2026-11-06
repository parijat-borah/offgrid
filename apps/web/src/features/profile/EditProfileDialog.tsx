import { AVATARS, DIFFICULTY_LABELS, TRAVEL_STYLES, type Gender, type Me, type MascotSpecies, type ProfileFields, type TravelStyle } from "@offgrid/core";
import { useId, useState, type FormEvent } from "react";
import { Callout } from "../../design/Badge";
import { Button } from "../../design/Button";
import { Dialog } from "../../design/Dialog";
import { Chip, Segmented } from "../../design/Fields";
import { api, ApiFailure, errorMessage } from "../../lib/api";
import { SPECIES_NAMES, Wanderling } from "../mascot/Wanderling";

const STYLE_LABELS: Record<TravelStyle, string> = {
  solo: "Solo",
  group: "Group",
  budget: "Budget",
  comfort: "Comfort",
  slow: "Slow travel",
  fast: "Fast-paced",
  photographer: "Photographer",
  foodie: "Foodie",
  spiritual: "Spiritual",
  adventure: "Adventure",
};
export { STYLE_LABELS };

const input = "min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-base";

export function EditProfileDialog({ me, open, onClose, onSaved }: { me: Me; open: boolean; onClose: () => void; onSaved: (me: Me) => void }) {
  const [form, setForm] = useState<ProfileFields>(() => pick(me));
  const [gender, setGender] = useState<Gender>(me.gender);
  const genderId = useId();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = { name: useId(), bio: useId(), city: useId() };

  const set = <K extends keyof ProfileFields>(k: K, v: ProfileFields[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggleStyle = (s: TravelStyle) =>
    set("styleTags", form.styleTags.includes(s) ? form.styleTags.filter((x) => x !== s) : [...form.styleTags, s].slice(0, 5));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      onSaved(await api<Me>("/me", { method: "PATCH", body: { ...form, ...(me.genderVerified ? {} : { gender }) } }));
      onClose();
    } catch (err) {
      if (err instanceof ApiFailure) setFields(err.fields);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} title="Edit profile" onClose={onClose} wide>
      <form onSubmit={save} className="space-y-5" noValidate>
        {error && <Callout tone="danger">{error}</Callout>}

        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Your Wanderling</legend>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(SPECIES_NAMES) as MascotSpecies[]).map((s) => (
              <label
                key={s}
                className={`flex cursor-pointer flex-col items-center rounded-xl border p-2 text-center text-xs font-semibold has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-sun-500 ${
                  form.mascotSpecies === s ? "border-pine-700 bg-pine-50" : "border-line"
                }`}
              >
                <input type="radio" name="species" className="sr-only" checked={form.mascotSpecies === s} onChange={() => set("mascotSpecies", s)} />
                <Wanderling species={s} stage={me.stage.id} size={72} motion="still" />
                {SPECIES_NAMES[s]}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Avatar</legend>
          <div className="flex flex-wrap gap-2">
            {AVATARS.map((a) => (
              <button
                key={a}
                type="button"
                aria-pressed={form.avatar === a}
                aria-label={`Avatar ${a}`}
                onClick={() => set("avatar", a)}
                className={`grid size-12 place-items-center rounded-full border-2 text-2xl ${form.avatar === a ? "border-pine-700 bg-pine-50" : "border-line"}`}
              >
                {a}
              </button>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor={ids.name} className="mb-1 block text-sm font-semibold">
            Name
          </label>
          <input id={ids.name} className={input} value={form.displayName} maxLength={40} onChange={(e) => set("displayName", e.target.value)} aria-invalid={fields.displayName ? true : undefined} />
          {fields.displayName && <p className="mt-1 text-sm text-danger-700">{fields.displayName}</p>}
        </div>
        <div>
          <label htmlFor={ids.city} className="mb-1 block text-sm font-semibold">
            Home city
          </label>
          <input id={ids.city} className={input} value={form.homeCity} maxLength={60} onChange={(e) => set("homeCity", e.target.value)} />
        </div>
        <div>
          <label htmlFor={ids.bio} className="mb-1 block text-sm font-semibold">
            Bio <span className="font-normal text-muted">({280 - form.bio.length} left)</span>
          </label>
          <textarea id={ids.bio} rows={3} maxLength={280} className="w-full rounded-xl border border-line bg-surface p-3 text-base" value={form.bio} onChange={(e) => set("bio", e.target.value)} />
        </div>

        <div>
          <label htmlFor={genderId} className="mb-1 block text-sm font-semibold">
            Gender
          </label>
          <select id={genderId} className={input} value={gender} disabled={me.genderVerified} onChange={(e) => setGender(e.target.value as Gender)}>
            <option value="prefer_not">Prefer not to say</option>
            <option value="woman">Woman</option>
            <option value="man">Man</option>
            <option value="nonbinary">Non-binary / transgender</option>
          </select>
          <p className="mt-1 text-xs text-muted">
            {me.genderVerified ? "Confirmed from your ID. Remove ID verification to change it." : "Never shown on your profile. Women-only matching uses your ID-verified gender, not this."}
          </p>
        </div>

        <fieldset>
          <legend className="text-sm font-semibold">Travel style</legend>
          <p className="mb-2 text-xs text-muted">Pick up to 5.</p>
          <div className="flex flex-wrap gap-2">
            {TRAVEL_STYLES.map((s) => (
              <Chip key={s} selected={form.styleTags.includes(s)} onToggle={() => toggleStyle(s)}>
                {STYLE_LABELS[s]}
              </Chip>
            ))}
          </div>
        </fieldset>

        <Segmented<1 | 2 | 3>
          label="Fitness level"
          value={form.fitnessLevel}
          onChange={(v) => set("fitnessLevel", v)}
          options={[1, 2, 3].map((n) => ({ value: n as 1 | 2 | 3, label: DIFFICULTY_LABELS[n]! }))}
        />

        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input type="checkbox" checked={form.leaderboardOptIn} onChange={(e) => set("leaderboardOptIn", e.target.checked)} className="mt-0.5 size-5 accent-pine-700" />
          <span>
            <span className="font-semibold">Show me on leaderboards</span>
            <span className="block text-muted">Off by default. Your activity can reveal where you are, so it's your call.</span>
          </span>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function pick(me: Me): ProfileFields {
  const { displayName, avatar, bio, homeCity, styleTags, mascotSpecies, fitnessLevel, leaderboardOptIn } = me;
  return { displayName, avatar, bio, homeCity, styleTags, mascotSpecies, fitnessLevel, leaderboardOptIn };
}
