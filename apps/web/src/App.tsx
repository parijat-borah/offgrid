import { decodeShare, encodeShare, PlannerInputSchema, recommend, type PlannerData, type PlannerInput } from "@offgrid/core";
import { lazy, Suspense, useEffect, useState } from "react";
import { ErrorBoundary } from "./design/ErrorBoundary";
import { ErrorState, Skeleton } from "./design/States";
import { AuthView, type AuthMode } from "./features/auth/AuthView";
import { BottomNav, MobileHeader, Sidebar, TopBar, type ShellProps, type ShellTarget } from "./features/shell/Shell";
import { HomeView } from "./features/planner/HomeView";
import { AlertsView } from "./features/safety/AlertsView";
import { BuddiesView } from "./features/social/BuddiesView";
import { InboxView } from "./features/social/InboxView";
import { TypeQuizView } from "./features/social/TypeQuizView";
import { KycConsentView } from "./features/verify/KycConsentView";
import { useInbox } from "./lib/inbox";
import { useTripAlerts } from "./lib/alerts";

// Screens with a map pull in Leaflet (~45 KB gzipped), so they load on demand. The service worker
// precaches every chunk, so they still open offline.
const NearbyView = lazy(() => import("./features/nearby/NearbyView").then((m) => ({ default: m.NearbyView })));
const SubmitPlaceView = lazy(() => import("./features/community/SubmitPlaceView").then((m) => ({ default: m.SubmitPlaceView })));
const ReviewView = lazy(() => import("./features/community/ReviewView").then((m) => ({ default: m.ReviewView })));
const ModerationView = lazy(() => import("./features/community/ModerationView").then((m) => ({ default: m.ModerationView })));
const ChatView = lazy(() => import("./features/social/ChatView").then((m) => ({ default: m.ChatView })));
const LeaderboardView = lazy(() => import("./features/leaderboard/LeaderboardView").then((m) => ({ default: m.LeaderboardView })));
const ExpensesView = lazy(() => import("./features/expenses/ExpensesView").then((m) => ({ default: m.ExpensesView })));
const SosView = lazy(() => import("./features/sos/SosView").then((m) => ({ default: m.SosView })));
const BeaconView = lazy(() => import("./features/sos/BeaconView").then((m) => ({ default: m.BeaconView })));
const SosStatusView = lazy(() => import("./features/sos/SosStatusView").then((m) => ({ default: m.SosStatusView })));
const ReportHazardView = lazy(() => import("./features/safety/ReportHazardView").then((m) => ({ default: m.ReportHazardView })));
import { CompareView } from "./features/planner/CompareView";
import { PlanView } from "./features/planner/PlanView";
import { ResultsView } from "./features/planner/ResultsView";
import { ProfileView } from "./features/profile/ProfileView";
import { TripDetailView } from "./features/trips/TripDetailView";
import { TripsView } from "./features/trips/TripsView";
import { useAuth } from "./lib/auth";
import { useOutboxSync } from "./lib/outbox";
import { usePack } from "./lib/pack";
import { KEYS, readJSON, writeJSON } from "./lib/storage";
import { useOnline } from "./lib/useOnline";

type View =
  | { name: "form" }
  | { name: "results" }
  | { name: "plan"; placeId: string }
  | { name: "compare"; a: string; b: string }
  | { name: "auth"; mode: AuthMode }
  | { name: "profile" }
  | { name: "trips" }
  | { name: "trip"; id: string }
  | { name: "nearby" }
  | { name: "add-place" }
  | { name: "review" }
  | { name: "moderation" }
  | { name: "alerts" }
  | { name: "report-hazard" }
  | { name: "quiz" }
  | { name: "inbox" }
  | { name: "leaderboard" }
  | { name: "sos" }
  | { name: "beacon" }
  | { name: "sos-status"; token: string }
  | { name: "buddies"; tripId: string }
  | { name: "chat"; id: string }
  | { name: "expenses"; tripId: string }
  | { name: "kyc-consent"; state: string };

const SIMPLE = ["profile", "trips", "nearby", "add-place", "review", "moderation", "alerts", "report-hazard", "quiz", "inbox", "leaderboard", "sos", "beacon"] as const;
const UUID = /^[0-9a-f-]{36}$/i;
const SLUG = /^[a-z0-9-]{1,60}$/;

/** The best-ranked other place for this input, to compare against; falls back to any other place. */
function nextBest(data: PlannerData, input: PlannerInput, placeId: string): string {
  return recommend(input, data, 8).ranked.find((r) => r.place.id !== placeId)?.place.id ?? data.places.find((p) => p.id !== placeId)!.id;
}

function defaultInput(): PlannerInput {
  const saved = PlannerInputSchema.safeParse(readJSON(KEYS.lastInput));
  if (saved.success) return saved.data;
  return { budgetPerPerson: 8000, days: 3, month: new Date().getMonth() + 1, fitness: 1, groupSize: 2, vibes: [] };
}

/** The URL is the source of truth for the current screen, so links can be shared and Back works. */
function readUrl(): { view: View; input: PlannerInput | null } {
  const params = new URLSearchParams(location.search);
  const { input, placeId } = decodeShare(location.search);
  const name = params.get("view");
  const id = params.get("id");
  if (input && name === "plan" && placeId) return { view: { name: "plan", placeId }, input };
  // "ca"/"cb", because the share encoding already uses single letters ("b" is the budget).
  const a = params.get("ca");
  const b = params.get("cb");
  if (input && name === "compare" && a && b && SLUG.test(a) && SLUG.test(b)) return { view: { name: "compare", a, b }, input };
  if (input && name === "results") return { view: { name: "results" }, input };
  if (name === "auth") return { view: { name: "auth", mode: params.get("mode") === "signup" ? "signup" : "login" }, input };
  if (name === "trip" && id && UUID.test(id)) return { view: { name: "trip", id }, input };
  if (name === "buddies" && id && UUID.test(id)) return { view: { name: "buddies", tripId: id }, input };
  if (name === "expenses" && id && UUID.test(id)) return { view: { name: "expenses", tripId: id }, input };
  if (name === "chat" && id && UUID.test(id)) return { view: { name: "chat", id }, input };
  const token = params.get("token");
  if (name === "sos-status" && token && /^[A-Za-z0-9_-]{20,64}$/.test(token)) return { view: { name: "sos-status", token }, input };
  const state = params.get("state");
  if (name === "kyc-consent" && state && /^[A-Za-z0-9_-]{10,100}$/.test(state)) return { view: { name: "kyc-consent", state }, input };
  const simple = SIMPLE.find((s) => s === name);
  if (simple) return { view: { name: simple }, input };
  return { view: { name: "form" }, input };
}

function urlFor(view: View, input: PlannerInput): string {
  switch (view.name) {
    case "form":
      return location.pathname;
    case "results":
      return `?view=results&${encodeShare(input)}`;
    case "plan":
      return `?view=plan&${encodeShare(input, view.placeId)}`;
    case "compare":
      return `?view=compare&ca=${view.a}&cb=${view.b}&${encodeShare(input)}`;
    case "auth":
      return `?view=auth&mode=${view.mode}`;
    case "trip":
      return `?view=trip&id=${view.id}`;
    case "buddies":
      return `?view=buddies&id=${view.tripId}`;
    case "chat":
      return `?view=chat&id=${view.id}`;
    case "expenses":
      return `?view=expenses&id=${view.tripId}`;
    case "sos-status":
      return `?view=sos-status&token=${view.token}`;
    case "kyc-consent":
      return `?view=kyc-consent&state=${encodeURIComponent(view.state)}`;
    default:
      return `?view=${view.name}`;
  }
}

const WIDE_VIEWS = new Set<View["name"]>(["form", "results", "plan", "compare", "nearby", "trips", "trip", "profile", "sos-status"]);

/** Shown in the laptop top bar so you always know where you are. */
const TITLES: Partial<Record<View["name"], string>> = {
  form: "Plan a trip",
  results: "Your matches",
  compare: "Compare two places",
  auth: "Your account",
  profile: "Profile",
  trips: "My trips",
  trip: "Trip",
  nearby: "Nearby",
  "add-place": "Add a hidden place",
  review: "Review places",
  moderation: "Moderation",
  alerts: "Trip alerts",
  "report-hazard": "Report a hazard",
  quiz: "Traveller type",
  inbox: "Messages",
  leaderboard: "Leaderboard",
  buddies: "Travel buddies",
  chat: "Chat",
  expenses: "Split expenses",
  sos: "Emergency",
  beacon: "SOS beacon",
  "sos-status": "SOS status",
  "kyc-consent": "ID verification",
};

export function App() {
  const { state: pack, reload: reloadPack } = usePack();
  const [view, setView] = useState<View>(() => readUrl().view);
  const [input, setInput] = useState<PlannerInput>(() => readUrl().input ?? defaultInput());
  // Where to return after logging in (e.g. back to the plan the guest tried to save).
  const [afterAuth, setAfterAuth] = useState<View>({ name: "profile" });
  const online = useOnline();
  const auth = useAuth();
  useOutboxSync(auth.status === "authed");
  const inbox = useInbox(auth.status === "authed");
  const tripAlerts = useTripAlerts(pack.status === "ready" ? pack.pack : null, auth.status === "authed");

  useEffect(() => {
    const onPop = () => {
      const next = readUrl();
      setView(next.view);
      if (next.input) setInput(next.input);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const go = (next: View, nextInput: PlannerInput = input) => {
    history.pushState(null, "", urlFor(next, nextInput));
    setInput(nextInput);
    setView(next);
    window.scrollTo({ top: 0 });
  };

  const requireLogin = (returnTo: View) => {
    setAfterAuth(returnTo);
    go({ name: "auth", mode: "signup" });
  };

  // Trips need an account; send guests to log in and bring them back afterwards.
  const needsAuth = view.name === "trips" || view.name === "trip" || view.name === "buddies" || view.name === "chat" || view.name === "expenses";
  useEffect(() => {
    if (needsAuth && auth.status === "guest" && !auth.serverDown) {
      setAfterAuth(view);
      history.replaceState(null, "", urlFor({ name: "auth", mode: "login" }, input));
      setView({ name: "auth", mode: "login" });
    }
  }, [needsAuth, auth.status, auth.serverDown, view, input]);

  const activeNav =
    view.name === "trips" || view.name === "trip" || view.name === "buddies" || view.name === "expenses"
      ? "trips"
      : view.name === "nearby" || view.name === "add-place" || view.name === "review" || view.name === "report-hazard"
        ? "nearby"
        : view.name === "profile" || view.name === "auth" || view.name === "moderation" || view.name === "quiz" || view.name === "inbox" || view.name === "leaderboard" || view.name === "beacon" || view.name === "chat" || view.name === "kyc-consent"
          ? "profile"
          : "plan";

  const shellActive: ShellProps["active"] =
    view.name === "inbox" || view.name === "chat"
      ? "inbox"
      : view.name === "alerts" || view.name === "leaderboard" || view.name === "beacon" || view.name === "sos"
        ? view.name
        : activeNav;
  const shellGo = (t: ShellTarget) => {
    if (t === "home" || t === "plan") go({ name: "form" });
    else go({ name: t });
  };
  const shell: ShellProps = {
    active: shellActive,
    me: auth.me ?? null,
    inboxBadge: inbox.badge,
    alertsBadge: tripAlerts.unseenCount,
    online,
    savedAt: pack.status === "ready" ? pack.savedAt : null,
    onGo: shellGo,
  };
  // Lists, maps and plans use the full width on a laptop; forms and chat stay at a readable measure.
  const wide = WIDE_VIEWS.has(view.name);
  const placeName = (id: string) => (pack.status === "ready" ? pack.pack.planner.places.find((p) => p.id === id)?.name : undefined) ?? "";
  const title = TITLES[view.name] ?? (view.name === "plan" ? `Plan · ${placeName(view.placeId)}` : "");

  return (
    <div className="min-h-dvh lg:pl-64">
      <Sidebar {...shell} />
      <MobileHeader {...shell} />
      <TopBar me={shell.me} online={online} onGo={shellGo} title={title} />

      <main className={`mx-auto px-4 pt-5 pb-28 sm:px-6 lg:px-8 lg:pt-8 lg:pb-12 ${wide ? "max-w-7xl" : "max-w-3xl"}`}>
        {pack.status === "loading" && (
          <div className="space-y-4" aria-busy="true" aria-label="Loading region data">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-64" />
            <Skeleton className="h-32" />
          </div>
        )}

        {pack.status === "error" && <ErrorState title="Couldn't load the Himachal data pack" detail={pack.message} onRetry={() => void reloadPack()} />}

        {pack.status === "ready" && (
          <ErrorBoundary resetKey={urlFor(view, input)}>
          <Suspense fallback={<Skeleton className="h-64" />}>
            {view.name === "form" && (
              <HomeView
                data={pack.pack.planner}
                input={input}
                onSubmit={(next) => {
                  writeJSON(KEYS.lastInput, next);
                  go({ name: "results" }, next);
                }}
                onOpenPlace={(placeId) => go({ name: "plan", placeId })}
              />
            )}
            {view.name === "results" && (
              <ResultsView
                data={pack.pack.planner}
                input={input}
                onOpen={(placeId) => go({ name: "plan", placeId })}
                onEdit={() => go({ name: "form" })}
                onCompare={(a, b) => go({ name: "compare", a, b })}
              />
            )}
            {view.name === "plan" && (
              <PlanView
                pack={pack.pack}
                input={input}
                placeId={view.placeId}
                onBack={() => go({ name: "results" })}
                onSaved={(id) => go({ name: "trip", id })}
                onRequireLogin={() => requireLogin(view)}
                onCompare={() => go({ name: "compare", a: view.placeId, b: nextBest(pack.pack.planner, input, view.placeId) })}
              />
            )}
            {view.name === "compare" && (
              <CompareView
                data={pack.pack.planner}
                input={input}
                a={view.a}
                b={view.b}
                onPick={(a, b) => {
                  // Swapping places replaces history so Back still goes to the results.
                  const next = { name: "compare" as const, a, b };
                  history.replaceState(null, "", urlFor(next, input));
                  setView(next);
                }}
                onOpen={(placeId) => go({ name: "plan", placeId })}
                onBack={() => go({ name: "results" })}
                onEdit={() => go({ name: "form" })}
              />
            )}
            {view.name === "auth" && <AuthView mode={view.mode} onMode={(mode) => go({ name: "auth", mode })} onDone={() => go(afterAuth)} />}
            {view.name === "profile" && (
              <ProfileView
                data={pack.pack.planner}
                onLogin={() => requireLogin({ name: "profile" })}
                onOpenTrip={(id) => go({ name: "trip", id })}
                onPlan={() => go({ name: "form" })}
                onAddPlace={() => go({ name: "add-place" })}
                onModerate={() => go({ name: "moderation" })}
                onQuiz={() => go({ name: "quiz" })}
                onLeaderboard={() => go({ name: "leaderboard" })}
                onBeacon={() => go({ name: "beacon" })}
              />
            )}
            {view.name === "nearby" && (
              <NearbyView
                pack={pack.pack}
                packSource={pack.source}
                onAddPlace={() => go({ name: "add-place" })}
                onReview={() => go({ name: "review" })}
                onReportHazard={() => go({ name: "report-hazard" })}
                onOpenPlace={(placeId) => go({ name: "plan", placeId })}
              />
            )}
            {view.name === "report-hazard" && (
              <ReportHazardView pack={pack.pack} onLogin={() => requireLogin({ name: "report-hazard" })} onDone={() => go({ name: "nearby" })} />
            )}
            {view.name === "sos" && <SosView data={pack.pack.planner} onLogin={() => requireLogin({ name: "sos" })} onBeacon={() => go({ name: "beacon" })} />}
            {view.name === "beacon" && <BeaconView onBack={() => go({ name: "sos" })} onLogin={() => requireLogin({ name: "beacon" })} />}
            {view.name === "sos-status" && <SosStatusView token={view.token} data={pack.pack.planner} />}
            {view.name === "leaderboard" && (
              <LeaderboardView onBack={() => go({ name: "profile" })} onLogin={() => requireLogin({ name: "leaderboard" })} onOpenTrip={(id) => go({ name: "trip", id })} />
            )}
            {view.name === "quiz" && <TypeQuizView onDone={() => go({ name: "profile" })} onLogin={() => requireLogin({ name: "quiz" })} />}
            {view.name === "kyc-consent" && <KycConsentView state={view.state} onDone={() => go({ name: "profile" })} />}
            {view.name === "inbox" && (
              <InboxView
                data={pack.pack.planner}
                requests={inbox.requests}
                conversations={inbox.conversations}
                loaded={inbox.loaded}
                onRefresh={inbox.refresh}
                onOpenChat={(id) => go({ name: "chat", id })}
                onLogin={() => requireLogin({ name: "inbox" })}
              />
            )}
            {view.name === "buddies" && auth.status === "authed" && (
              <BuddiesView
                data={pack.pack.planner}
                tripId={view.tripId}
                onBack={() => go({ name: "trip", id: view.tripId })}
                onVerify={() => go({ name: "profile" })}
                onQuiz={() => go({ name: "quiz" })}
                onInbox={() => go({ name: "inbox" })}
              />
            )}
            {view.name === "chat" && auth.status === "authed" && (
              <ChatView data={pack.pack.planner} conversationId={view.id} onBack={() => go({ name: "inbox" })} onChanged={inbox.refresh} />
            )}
            {view.name === "alerts" && (
              <AlertsView
                pack={pack.pack}
                alerts={tripAlerts.alerts}
                trips={tripAlerts.trips}
                authed={auth.status === "authed"}
                permission={tripAlerts.permission}
                onRequestPermission={() => void tripAlerts.requestPermission()}
                onSeen={tripAlerts.markAllSeen}
                onOpenTrip={(id) => go({ name: "trip", id })}
                onLogin={() => requireLogin({ name: "alerts" })}
                onPlan={() => go({ name: "form" })}
              />
            )}
            {view.name === "add-place" && (
              <SubmitPlaceView pack={pack.pack} onLogin={() => requireLogin({ name: "add-place" })} onDone={() => go({ name: "nearby" })} />
            )}
            {view.name === "review" && <ReviewView pack={pack.pack} onLogin={() => requireLogin({ name: "review" })} />}
            {view.name === "moderation" && <ModerationView />}
            {view.name === "trips" && auth.status === "authed" && (
              <TripsView data={pack.pack.planner} onOpen={(id) => go({ name: "trip", id })} onPlan={() => go({ name: "form" })} />
            )}
            {view.name === "trip" && auth.status === "authed" && (
              <TripDetailView data={pack.pack.planner} tripId={view.id} onBack={() => go({ name: "trips" })} onProfile={() => go({ name: "profile" })} onBuddies={(tripId) => go({ name: "buddies", tripId })} onExpenses={(tripId) => go({ name: "expenses", tripId })} />
            )}
            {view.name === "expenses" && auth.status === "authed" && (
              <ExpensesView data={pack.pack.planner} tripId={view.tripId} onBack={() => go({ name: "trip", id: view.tripId })} />
            )}
            {needsAuth && auth.status === "loading" && <Skeleton className="h-40" />}
            {needsAuth && auth.status === "guest" && auth.serverDown && (
              <ErrorState title="Can't reach the OFFGRID server" detail="Your saved trips need a connection. The planner and Nearby still work offline." onRetry={() => void auth.reload()} />
            )}
          </Suspense>
          </ErrorBoundary>
        )}
      </main>

      <footer className={`mx-auto hidden px-4 pb-10 text-center text-xs text-muted sm:px-6 lg:block lg:px-8 ${wide ? "max-w-7xl" : "max-w-3xl"}`}>
        All costs are estimates. Always check local road, weather and permit status. Emergency: 112.
      </footer>

      <BottomNav active={shell.active} me={shell.me} onGo={shellGo} />
    </div>
  );
}
