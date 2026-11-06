import type { Me } from "@offgrid/core";
import { Backpack, Bell, CircleUserRound, Compass, MapPin, MessageCircle, RadioTower, Siren, Trophy, Wifi, WifiOff, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { OutboxButton } from "../community/OutboxButton";

export type NavKey = "plan" | "nearby" | "trips" | "profile";
export type ShellTarget = NavKey | "inbox" | "alerts" | "leaderboard" | "beacon" | "sos" | "home";

const MAIN: { key: NavKey; label: string; icon: LucideIcon; hint: string }[] = [
  { key: "plan", label: "Plan a trip", icon: Compass, hint: "Find treks that fit" },
  { key: "nearby", label: "Nearby", icon: MapPin, hint: "Food, stays, water, toilets" },
  { key: "trips", label: "My trips", icon: Backpack, hint: "Plans and history" },
  { key: "profile", label: "Profile", icon: CircleUserRound, hint: "Level, badges, trust" },
];
const SHORT: Record<NavKey, string> = { plan: "Plan", nearby: "Nearby", trips: "Trips", profile: "Profile" };

export interface ShellProps {
  active: NavKey | "inbox" | "alerts" | "leaderboard" | "beacon" | "sos" | null;
  me: Me | null;
  inboxBadge: number;
  alertsBadge: number;
  online: boolean;
  savedAt: number | null;
  onGo: (t: ShellTarget) => void;
}

function Logo({ onClick, dark = false }: { onClick: () => void; dark?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-11 items-center gap-2.5 rounded-lg" aria-label="OFFGRID home: new plan">
      <svg aria-hidden="true" viewBox="0 0 32 32" className="size-8 shrink-0">
        <rect width="32" height="32" rx="9" fill={dark ? "#1f7a52" : "#ffffff"} fillOpacity={dark ? 1 : 0.14} />
        <path d="M5 24 L13 11 L18 18 L21 14 L27 24 Z" fill="white" />
      </svg>
      <span className="font-display text-lg font-extrabold tracking-[0.12em]">OFFGRID</span>
    </button>
  );
}

function CountBadge({ n, className = "" }: { n: number; className?: string }) {
  if (n <= 0) return null;
  return (
    <span aria-hidden="true" className={`grid min-w-5 place-items-center rounded-full bg-danger-700 px-1.5 text-[11px] font-bold text-white ${className}`}>
      {n > 9 ? "9+" : n}
    </span>
  );
}

function OnlinePill({ online, compact = false }: { online: boolean; compact?: boolean }) {
  return (
    <span
      role="status"
      aria-label={online ? "Online" : "Offline"}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${online ? "bg-pine-50 text-pine-700" : "bg-sun-500 text-white"}`}
    >
      {online ? <Wifi aria-hidden="true" className="size-3.5" /> : <WifiOff aria-hidden="true" className="size-3.5" />}
      <span aria-hidden="true" className={compact && online ? "sr-only" : ""}>
        {online ? "Online" : "Offline"}
      </span>
    </span>
  );
}

function LevelChip({ me, onClick, onDark = false }: { me: Me; onClick: () => void; onDark?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-9 items-center gap-2 whitespace-nowrap rounded-full py-1 pr-3 pl-1 text-xs font-bold ${onDark ? "bg-white/10 text-white hover:bg-white/20" : "border border-line bg-surface hover:border-pine-600"}`}
      aria-label={`${me.displayName}, level ${me.level.level}, ${me.level.xp} XP. Open profile`}
    >
      <span aria-hidden="true" className="grid size-7 place-items-center rounded-full bg-sun-500 text-sm">
        {me.avatar}
      </span>
      <span aria-hidden="true">Lv {me.level.level}</span>
    </button>
  );
}

/** Laptop and desktop: a fixed sidebar with every destination, so nothing hides behind a menu. */
export function Sidebar({ active, me, inboxBadge, alertsBadge, online, savedAt, onGo }: ShellProps) {
  const item = (key: ShellTarget, label: string, Icon: LucideIcon, hint?: string, badge = 0) => {
    const on = active === key;
    return (
      <li key={key}>
        <button
          type="button"
          aria-current={on ? "page" : undefined}
          onClick={() => onGo(key)}
          className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
            on ? "bg-white text-pine-800 shadow-[var(--shadow-card)]" : "text-pine-100 hover:bg-white/10 hover:text-white"
          }`}
        >
          <Icon aria-hidden="true" className="size-5 shrink-0" strokeWidth={on ? 2.4 : 2} />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{label}</span>
            {hint && <span className={`block truncate text-xs ${on ? "text-muted" : "text-pine-100/70"}`}>{hint}</span>}
          </span>
          <CountBadge n={badge} />
        </button>
      </li>
    );
  };

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-pine-900 text-white lg:flex" aria-label="Sidebar">
      <div className="flex h-16 items-center px-5">
        <Logo onClick={() => onGo("home")} />
      </div>
      <nav aria-label="Main" className="scroll-thin flex-1 overflow-y-auto px-3 pb-4">
        <ul className="space-y-1">{MAIN.map((m) => item(m.key, m.label, m.icon, m.hint))}</ul>
        <p className="mt-6 mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-pine-100/60">Community &amp; safety</p>
        <ul className="space-y-1">
          {me && item("inbox", "Messages", MessageCircle, undefined, inboxBadge)}
          {me && item("alerts", "Trip alerts", Bell, undefined, alertsBadge)}
          {item("leaderboard", "Leaderboard", Trophy)}
          {item("beacon", "SOS beacon", RadioTower)}
        </ul>
      </nav>
      <div className="space-y-3 border-t border-white/10 p-4">
        <button
          type="button"
          onClick={() => onGo("sos")}
          aria-current={active === "sos" ? "page" : undefined}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-danger-700 px-3 py-3 font-extrabold tracking-wide text-white shadow-lg ring-1 ring-white/20 hover:bg-danger-700/90"
          aria-label="Emergency: SOS and 112"
        >
          <Siren aria-hidden="true" className="size-5" />
          SOS · 112
        </button>
        <div className="flex items-center justify-between gap-2 text-xs text-pine-100/80">
          <span>
            Himachal pack
            {savedAt ? ` · ${new Date(savedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}
          </span>
          <span className={`inline-flex items-center gap-1 font-semibold ${online ? "text-pine-100" : "text-sun-50"}`}>
            {online ? <Wifi aria-hidden="true" className="size-3.5" /> : <WifiOff aria-hidden="true" className="size-3.5" />}
            {online ? "Online" : "Offline"}
          </span>
        </div>
      </div>
    </aside>
  );
}

/** Laptop: a light top bar over the content with sync state and your level. */
export function TopBar({ me, online, title, onGo }: Pick<ShellProps, "me" | "online" | "onGo"> & { title: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 hidden h-14 items-center justify-between gap-4 border-b border-line bg-paper/85 px-8 backdrop-blur lg:flex">
      <p className="truncate text-sm font-semibold text-muted">{title}</p>
      <div className="flex items-center gap-2">
        <OutboxButton />
        <OnlinePill online={online} />
        {me ? (
          <LevelChip me={me} onClick={() => onGo("profile")} />
        ) : (
          <button type="button" onClick={() => onGo("profile")} className="min-h-9 rounded-full bg-pine-700 px-4 text-sm font-semibold text-white hover:bg-pine-800">
            Log in
          </button>
        )}
      </div>
    </header>
  );
}

/** Phones and tablets: compact header with the actions people reach for on the trail. */
export function MobileHeader({ me, inboxBadge, alertsBadge, online, onGo }: ShellProps) {
  const iconBtn = (key: ShellTarget, label: string, Icon: LucideIcon, badge: number) => (
    <button
      type="button"
      onClick={() => onGo(key)}
      className="relative grid size-10 place-items-center rounded-full hover:bg-white/10"
      aria-label={badge ? `${label}, ${badge} new` : label}
    >
      <Icon aria-hidden="true" className="size-5" />
      <CountBadge n={badge} className="absolute -top-0.5 -right-0.5" />
    </button>
  );
  return (
    <header className="sticky top-0 z-20 bg-pine-900 text-white lg:hidden">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-1 px-3 sm:px-4">
        <Logo onClick={() => onGo("home")} />
        <div className="flex items-center gap-0.5 sm:gap-1.5">
          <button
            type="button"
            onClick={() => onGo("sos")}
            className="mr-1 flex min-h-9 items-center gap-1 rounded-full bg-danger-700 px-3 text-xs font-extrabold tracking-wider text-white ring-2 ring-white/60"
            aria-label="Emergency: SOS and 112"
          >
            <Siren aria-hidden="true" className="size-4" />
            SOS
          </button>
          <OutboxButton />
          {me && iconBtn("inbox", "Requests and chats", MessageCircle, inboxBadge)}
          {me && iconBtn("alerts", "Trip alerts", Bell, alertsBadge)}
          {!online && <OnlinePill online={false} />}
          {online && <span role="status" aria-label="Online" className="mx-1 size-2 rounded-full bg-pine-100" />}
        </div>
      </div>
    </header>
  );
}

/** Phones: thumb-reach bottom navigation. */
export function BottomNav({ active, me, onGo }: Pick<ShellProps, "active" | "me" | "onGo">) {
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <ul className="mx-auto grid h-16 max-w-3xl grid-cols-4">
        {MAIN.map(({ key, icon: Icon }) => {
          const on = active === key;
          return (
            <li key={key}>
              <button
                type="button"
                aria-current={on ? "page" : undefined}
                onClick={() => onGo(key)}
                className={`relative flex h-full w-full flex-col items-center justify-center gap-0.5 text-xs font-semibold ${on ? "text-pine-700" : "text-muted hover:text-ink"}`}
              >
                {on && <span aria-hidden="true" className="absolute top-0 h-0.5 w-10 rounded-full bg-pine-700" />}
                {key === "profile" && me ? (
                  <span aria-hidden="true" className="text-xl leading-5">
                    {me.avatar}
                  </span>
                ) : (
                  <Icon aria-hidden="true" className="size-5" strokeWidth={on ? 2.4 : 2} />
                )}
                {SHORT[key]}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
