import { checkSeason, DIFFICULTY_LABELS, monthName, type PlannerData, type PlannerInput } from "@offgrid/core";
import { RadioTower, ShieldCheck, Users, WifiOff } from "lucide-react";
import { useMemo } from "react";
import { Card } from "../../design/Card";
import { PlaceHero } from "../places/PlacePhotos";
import { PlannerForm } from "./PlannerForm";

const WHY = [
  { icon: WifiOff, title: "Works with no signal", text: "Plans, maps and 800+ nearby places live on your phone." },
  { icon: ShieldCheck, title: "Safety first", text: "Seasons, landslides, wildlife zones and the nearest hospital, before you go." },
  { icon: Users, title: "Verified travel buddies", text: "Matched per trip. Contact details stay hidden until you both agree." },
  { icon: RadioTower, title: "SOS without a network", text: "A ₹2,500 LoRa beacon reaches your family when phones can't." },
];

/** The landing screen: what OFFGRID is, the planner, and treks that are good right now. */
export function HomeView({ data, input, onSubmit, onOpenPlace }: { data: PlannerData; input: PlannerInput; onSubmit: (i: PlannerInput) => void; onOpenPlace: (placeId: string) => void }) {
  const hero = data.media.photos["triund"] ? "triund" : data.places[0]!.id;
  const trailCount = Object.keys(data.media.trails).length;

  // Places in a good season for the month in the form, treks with a mapped trail first.
  const inSeason = useMemo(
    () =>
      data.places
        .filter((p) => checkSeason(p, input.month, data.passes).status === "good")
        .sort((a, b) => Number(!!data.media.trails[b.id]) - Number(!!data.media.trails[a.id]) || a.difficulty - b.difficulty)
        .slice(0, 6),
    [data, input.month],
  );

  return (
    <div className="space-y-6 lg:space-y-8">
      <section className="relative -mx-4 -mt-5 overflow-hidden sm:mx-0 sm:mt-0 sm:rounded-3xl" aria-labelledby="home-title">
        <PlaceHero photos={data.media.photos[hero]} name="Triund ridge at dusk" className="aspect-auto h-64 rounded-none sm:h-72 lg:h-80" eager />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-t from-pine-900/90 via-pine-900/45 to-pine-900/10" />
        <div className="pointer-events-none absolute inset-x-0 bottom-8 px-5 text-white sm:px-8 lg:bottom-10 lg:px-10">
          <p className="text-xs font-semibold tracking-wider text-pine-100 uppercase">Himachal Pradesh · {data.places.length} places · works offline</p>
          <h1 id="home-title" className="mt-1 max-w-2xl text-3xl leading-tight font-extrabold sm:text-4xl lg:text-5xl">
            Trek further. Stay found.
          </h1>
          <p className="mt-2 max-w-xl text-sm text-white/90 sm:text-base">
            Season-smart trek plans for your budget and fitness, offline maps, verified travel buddies and an SOS that works without a network.
          </p>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-12 lg:gap-8">
        <div className="lg:col-span-7 xl:col-span-7">
          <PlannerForm initial={input} quiz={data.fitnessQuiz} onSubmit={onSubmit} />
        </div>

        <aside className="space-y-6 lg:col-span-5" aria-label="Ideas and highlights">
          {inSeason.length > 0 && (
            <section aria-labelledby="season-title">
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <h2 id="season-title" className="text-xl font-extrabold">
                  Good in {monthName(input.month)}
                </h2>
                <span className="text-xs text-muted">{trailCount} with trail maps</span>
              </div>
              <ul className="grid grid-cols-2 gap-3">
                {inSeason.map((p) => {
                  const trail = data.media.trails[p.id];
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => onOpenPlace(p.id)}
                        className="group w-full overflow-hidden rounded-2xl border border-line bg-surface text-left shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-lift)]"
                        aria-label={`${p.name}: ${DIFFICULTY_LABELS[p.difficulty]}, ${p.days_min} days. Open the plan`}
                      >
                        <PlaceHero photos={data.media.photos[p.id]} name={p.name} className="aspect-[4/3] rounded-none" inButton />
                        <span className="block p-3">
                          <span className="block truncate font-display font-bold">{p.name}</span>
                          <span className="block truncate text-xs text-muted">
                            {DIFFICULTY_LABELS[p.difficulty]} · {p.days_min}+ days{trail ? ` · 🥾 ${trail.length_km} km` : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <Card>
            <h2 className="mb-3 text-base font-extrabold">Why OFFGRID</h2>
            <ul className="space-y-3">
              {WHY.map(({ icon: Icon, title, text }) => (
                <li key={title} className="flex gap-3">
                  <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-pine-50 text-pine-700">
                    <Icon className="size-5" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold">{title}</span>
                    <span className="block text-sm text-muted">{text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  );
}
