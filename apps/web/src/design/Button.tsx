import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-pine-700 text-white hover:bg-pine-800 active:bg-pine-800",
  secondary: "bg-surface text-ink border border-line hover:bg-pine-50",
  ghost: "text-pine-700 hover:bg-pine-50",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  block?: boolean;
}

/** 44px minimum height everywhere, so every button is a comfortable tap target. */
export function Button({ variant = "primary", block = false, className = "", type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${block ? "w-full" : ""} ${className}`}
      {...props}
    />
  );
}
