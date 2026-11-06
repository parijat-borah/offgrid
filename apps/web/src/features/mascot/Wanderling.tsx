import type { MascotSpecies, MascotStageId } from "@offgrid/core";
import { useId, type ReactNode } from "react";

export const SPECIES_NAMES: Record<MascotSpecies, string> = {
  snow_leopard: "Snow leopard",
  monal: "Himalayan monal",
  red_panda: "Red panda",
};

const STAGE_ORDER: MascotStageId[] = ["rookie", "trail-hunter", "summit-seeker", "legend"];
const atLeast = (stage: MascotStageId, min: MascotStageId) => STAGE_ORDER.indexOf(stage) >= STAGE_ORDER.indexOf(min);

/** Head geometry per species, so accessories (cap, scarf) sit right on every body. */
const HEAD: Record<MascotSpecies, { top: number; neck: number }> = {
  snow_leopard: { top: 28, neck: 70 },
  red_panda: { top: 28, neck: 70 },
  monal: { top: 31, neck: 66 },
};

function SnowLeopard() {
  const spot = "#5b6470";
  return (
    <g>
      <path d="M80 96 C104 100 110 76 95 68" stroke="#cfd5db" strokeWidth="11" fill="none" strokeLinecap="round" />
      <circle cx="101" cy="88" r="2.6" fill={spot} />
      <circle cx="103" cy="78" r="2.6" fill={spot} />
      <circle cx="97" cy="70" r="2.4" fill={spot} />
      <ellipse cx="60" cy="86" rx="26" ry="20" fill="#e6e9ec" />
      <ellipse cx="60" cy="92" rx="15" ry="11" fill="#ffffff" />
      <circle cx="44" cy="80" r="2.6" fill={spot} />
      <circle cx="77" cy="82" r="2.6" fill={spot} />
      <circle cx="70" cy="74" r="2.2" fill={spot} />
      <ellipse cx="48" cy="104" rx="8" ry="4.5" fill="#e6e9ec" />
      <ellipse cx="72" cy="104" rx="8" ry="4.5" fill="#e6e9ec" />
      <circle cx="43" cy="32" r="7.5" fill="#e6e9ec" />
      <circle cx="77" cy="32" r="7.5" fill="#e6e9ec" />
      <circle cx="43" cy="32" r="3.5" fill="#f2b8c0" />
      <circle cx="77" cy="32" r="3.5" fill="#f2b8c0" />
      <circle cx="60" cy="50" r="22" fill="#eef0f2" />
      <circle cx="46" cy="42" r="2.2" fill={spot} />
      <circle cx="74" cy="41" r="2.2" fill={spot} />
      <circle cx="60" cy="35" r="2" fill={spot} />
      <ellipse cx="60" cy="59" rx="9" ry="6.5" fill="#ffffff" />
      <path d="M57 55 L63 55 L60 58.5 Z" fill="#d9828f" />
      <Eyes y={48} color="#2f6f5e" />
    </g>
  );
}

function RedPanda() {
  const rust = "#c2502a";
  return (
    <g>
      <path d="M80 96 C106 100 110 76 95 66" stroke={rust} strokeWidth="13" fill="none" strokeLinecap="round" />
      <path d="M80 96 C106 100 110 76 95 66" stroke="#7a2e14" strokeWidth="13" fill="none" strokeDasharray="5 7" strokeLinecap="butt" />
      <ellipse cx="60" cy="86" rx="26" ry="20" fill={rust} />
      <ellipse cx="60" cy="93" rx="16" ry="11" fill="#3b2318" />
      <ellipse cx="48" cy="104" rx="8" ry="4.5" fill="#3b2318" />
      <ellipse cx="72" cy="104" rx="8" ry="4.5" fill="#3b2318" />
      <circle cx="42" cy="32" r="8.5" fill="#fff3e6" />
      <circle cx="78" cy="32" r="8.5" fill="#fff3e6" />
      <circle cx="42" cy="33" r="5.5" fill={rust} />
      <circle cx="78" cy="33" r="5.5" fill={rust} />
      <circle cx="60" cy="50" r="22" fill={rust} />
      <ellipse cx="50" cy="42" rx="5" ry="3.5" fill="#fff3e6" />
      <ellipse cx="70" cy="42" rx="5" ry="3.5" fill="#fff3e6" />
      <ellipse cx="60" cy="59" rx="11" ry="8" fill="#fff3e6" />
      <path d="M52 51 L48 60 M68 51 L72 60" stroke="#7a2e14" strokeWidth="2.5" strokeLinecap="round" />
      <ellipse cx="60" cy="56" rx="3" ry="2.2" fill="#2a1a12" />
      <Eyes y={48} color="#2a1a12" />
    </g>
  );
}

function Monal({ gradId }: { gradId: string }) {
  return (
    <g>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2e7a8f" />
          <stop offset="0.55" stopColor="#3b4fa0" />
          <stop offset="1" stopColor="#5b3a8c" />
        </linearGradient>
      </defs>
      <ellipse cx="86" cy="94" rx="18" ry="9" fill="#d9772b" transform="rotate(-20 86 94)" />
      <ellipse cx="84" cy="98" rx="16" ry="7" fill="#e89a4a" transform="rotate(-5 84 98)" />
      <ellipse cx="60" cy="84" rx="24" ry="22" fill={`url(#${gradId})`} />
      <ellipse cx="71" cy="84" rx="11" ry="16" fill="#2c3f86" transform="rotate(-15 71 84)" />
      <path d="M52 105 L50 112 M68 105 L70 112" stroke="#8a7a5a" strokeWidth="3" strokeLinecap="round" />
      <ellipse cx="60" cy="64" rx="15" ry="6" fill="#b5651d" />
      <circle cx="60" cy="48" r="17" fill="#1f7a6a" />
      <circle cx="53" cy="47" r="5.2" fill="#3fa7d6" />
      <circle cx="67" cy="47" r="5.2" fill="#3fa7d6" />
      <path d="M56 53 L64 53 L60 61 Z" fill="#8a7a5a" />
      <Eyes y={47} color="#14212b" small />
    </g>
  );
}

function MonalCrest({ top }: { top: number }) {
  return (
    <g stroke="#1f7a6a" strokeWidth="2" strokeLinecap="round">
      {[-7, 0, 7].map((dx) => (
        <g key={dx}>
          <line x1={60} y1={top + 4} x2={60 + dx} y2={top - 10} />
          <ellipse cx={60 + dx} cy={top - 12} rx="2.4" ry="3.4" fill="#2bb59a" stroke="none" />
        </g>
      ))}
    </g>
  );
}

function Eyes({ y, color, small = false }: { y: number; color: string; small?: boolean }) {
  const r = small ? 2.3 : 3.2;
  return (
    <g className="og-eyes">
      <ellipse cx="52" cy={y} rx={r} ry={r * 1.15} fill={color} />
      <ellipse cx="68" cy={y} rx={r} ry={r * 1.15} fill={color} />
      <circle cx={52 + r * 0.35} cy={y - r * 0.4} r={r * 0.35} fill="#fff" />
      <circle cx={68 + r * 0.35} cy={y - r * 0.4} r={r * 0.35} fill="#fff" />
    </g>
  );
}

function Cap({ top }: { top: number }) {
  return (
    <g>
      <path d={`M41 ${top + 11} Q60 ${top - 9} 79 ${top + 11} Z`} fill="#c0392b" />
      <rect x="58" y={top + 7} width="25" height="5" rx="2.5" fill="#962d22" />
      <circle cx="60" cy={top + 1} r="2.4" fill="#f5d48a" />
    </g>
  );
}

function Backpack() {
  return (
    <g>
      <rect x="35" y="60" width="50" height="38" rx="11" fill="#8a5a2b" />
      <rect x="44" y="64" width="32" height="8" rx="4" fill="#a8743f" />
      <path d="M45 66 L45 92 M75 66 L75 92" stroke="#5e3b1a" strokeWidth="3.5" strokeLinecap="round" />
    </g>
  );
}

function Scarf({ neck, clipId }: { neck: number; clipId: string }) {
  // Prayer-flag colours: blue, white, red, green, yellow.
  const colors = ["#2f6db5", "#f4f4f4", "#c8372d", "#2f8f4e", "#e9b824"];
  return (
    <g>
      <clipPath id={clipId}>
        <path d={`M38 ${neck - 3} Q60 ${neck + 7} 82 ${neck - 3} L82 ${neck + 4} Q60 ${neck + 14} 38 ${neck + 4} Z`} />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        {colors.map((c, i) => (
          <rect key={c} x={38 + i * 9} y={neck - 6} width="9" height="22" fill={c} />
        ))}
      </g>
      <g transform={`rotate(14 72 ${neck + 4})`}>
        {colors.slice(0, 3).map((c, i) => (
          <rect key={c} x="68" y={neck + 4 + i * 5} width="8" height="5" fill={c} />
        ))}
      </g>
    </g>
  );
}

function SummitFlag() {
  return (
    <g>
      <line x1="100" y1="106" x2="100" y2="46" stroke="#6b4f2a" strokeWidth="3" strokeLinecap="round" />
      <path d="M100 46 L118 52 L100 58 Z" fill="#d9661d" />
    </g>
  );
}

export interface WanderlingProps {
  species: MascotSpecies;
  stage: MascotStageId;
  stageName?: string;
  size?: number;
  /** idle: gentle bob and blink. pop: the level-up entrance. still: no motion. */
  motion?: "idle" | "pop" | "still";
  className?: string;
}

/** The Wanderling mascot. Every stage adds gear: cap (Trail Hunter), backpack (Summit Seeker), scarf and flag (Legend). */
export function Wanderling({ species, stage, stageName, size = 120, motion = "idle", className = "" }: WanderlingProps) {
  const uid = useId().replace(/:/g, "");
  const head = HEAD[species];
  const label = `${SPECIES_NAMES[species]} Wanderling${stageName ? `, ${stageName}` : ""}`;
  const body: ReactNode =
    species === "snow_leopard" ? <SnowLeopard /> : species === "red_panda" ? <RedPanda /> : <Monal gradId={`${uid}-g`} />;

  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      role="img"
      aria-label={label}
      className={`${motion === "idle" ? "og-bob" : motion === "pop" ? "og-pop" : ""} ${className}`}
    >
      <defs>
        <radialGradient id={`${uid}-glow`}>
          <stop offset="0" stopColor="#f5d48a" stopOpacity="0.9" />
          <stop offset="1" stopColor="#f5d48a" stopOpacity="0" />
        </radialGradient>
      </defs>
      {stage === "legend" && <circle cx="60" cy="66" r="56" fill={`url(#${uid}-glow)`} />}
      <ellipse cx="60" cy="110" rx="32" ry="5" fill="#17212b" opacity="0.12" />
      {stage === "legend" && <SummitFlag />}
      {atLeast(stage, "summit-seeker") && <Backpack />}
      {body}
      {stage === "legend" && <Scarf neck={head.neck} clipId={`${uid}-scarf`} />}
      {atLeast(stage, "trail-hunter") && <Cap top={head.top} />}
      {species === "monal" && <MonalCrest top={atLeast(stage, "trail-hunter") ? head.top - 6 : head.top} />}
    </svg>
  );
}
