// The shared page pieces every screen is built from, so the whole app reads as one product:
// a page header (title + actions), cards, a strip of key figures, buttons, tabs, and a
// right-hand side panel for "open the whole record". Navy #24539B is the one primary colour.
import React, { useEffect } from "react";
import { X } from "lucide-react";

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

/** Title on the left (English, Urdu muted), what you can do on the right. */
export function PageHeader({
  title,
  urdu,
  subtitle,
  icon,
  actions,
}: {
  title: string;
  urdu?: string;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex-1 min-w-[220px]">
        <h1 className="text-[19px] font-semibold text-[#111827] flex items-center gap-2 leading-tight">
          {icon && <span className="text-[#24539B] [&>svg]:w-5 [&>svg]:h-5">{icon}</span>}
          {title}
          {urdu && <span className="text-[#9CA3AF] font-normal text-sm" dir="rtl">{urdu}</span>}
        </h1>
        {subtitle && <p className="text-[12.5px] text-[#6B7280] mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

type BtnKind = "primary" | "secondary" | "danger" | "ghost" | "outline";
const BTN: Record<BtnKind, string> = {
  primary: "bg-[#24539B] text-white border border-[#24539B] hover:bg-[#1E4480] shadow-sm",
  secondary: "bg-white text-[#1F2937] border border-[#CBD5E1] hover:bg-[#F4F6FA]",
  outline: "bg-white text-[#24539B] border border-[#24539B] hover:bg-[#EAF0F8]",
  danger: "bg-white text-[#B91C1C] border border-[#FECACA] hover:bg-[#FEF2F2]",
  ghost: "bg-transparent text-[#4B5563] border border-transparent hover:bg-[#EEF2F7]",
};

export function Btn({
  kind = "secondary",
  size = "md",
  icon,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: BtnKind; size?: "sm" | "md"; icon?: React.ReactNode }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap disabled:opacity-50",
        size === "sm" ? "text-xs px-2.5 py-1.5" : "text-[13px] px-3.5 py-2",
        BTN[kind],
        "[&>svg]:w-4 [&>svg]:h-4 [&>svg]:shrink-0",
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/** A white block with a hairline border; `title` gives it a header row. */
export function Card({
  title,
  actions,
  className,
  bodyClassName,
  children,
}: {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cx("bg-white border border-[#E3E8EF] rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)]", className)}>
      {(title || actions) && (
        <div className="flex items-center gap-2 px-4 h-11 border-b border-[#EEF1F5]">
          <div className="flex-1 min-w-0 text-[13px] font-semibold text-[#1F2937] truncate">{title}</div>
          {actions}
        </div>
      )}
      <div className={bodyClassName ?? (title ? "p-4" : "")}>{children}</div>
    </div>
  );
}

export type Kpi = { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "good" | "bad" | "warn"; onClick?: () => void };
const TONE: Record<string, string> = { good: "text-[#166534]", bad: "text-[#B91C1C]", warn: "text-[#B45309]" };

/** Key figures in one card, split by thin dividers (not a row of separate boxes). */
export function KpiStrip({ items }: { items: Kpi[] }) {
  return (
    <div className="bg-white border border-[#E3E8EF] rounded-xl grid grid-cols-2 md:flex md:divide-x divide-[#EEF1F5] overflow-hidden">
      {items.map((k, i) => {
        const body = (
          <>
            <div className="text-[11.5px] text-[#6B7280] truncate">{k.label}</div>
            <div className={cx("text-[19px] font-semibold tabular-nums leading-tight mt-0.5 truncate", k.tone ? TONE[k.tone] : "text-[#111827]")}>{k.value}</div>
            {k.sub && <div className="text-[11px] text-[#9CA3AF] truncate mt-0.5">{k.sub}</div>}
          </>
        );
        const cls = cx("flex-1 min-w-0 px-4 py-3 text-left", i % 2 === 1 && "border-l border-[#EEF1F5] md:border-l-0", i > 1 && "border-t border-[#EEF1F5] md:border-t-0");
        return k.onClick ? (
          <button key={i} onClick={k.onClick} className={cx(cls, "hover:bg-[#F8FAFC]")}>{body}</button>
        ) : (
          <div key={i} className={cls}>{body}</div>
        );
      })}
    </div>
  );
}

/** Underlined tabs, as on a record page. */
export function Tabs<T extends string>({ value, onChange, items, right }: { value: T; onChange: (v: T) => void; items: Array<{ id: T; label: React.ReactNode; count?: number }>; right?: React.ReactNode }) {
  return (
    <div className="flex items-end gap-1 border-b border-[#E3E8EF] overflow-x-auto no-scrollbar">
      {items.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            "px-3 py-2 -mb-px border-b-2 text-[13px] whitespace-nowrap inline-flex items-center gap-1.5",
            value === t.id ? "border-[#24539B] text-[#24539B] font-semibold" : "border-transparent text-[#6B7280] hover:text-[#1F2937]",
          )}
        >
          {t.label}
          {t.count != null && <span className={cx("text-[11px] rounded-full px-1.5", value === t.id ? "bg-[#EAF0F8]" : "bg-[#F1F4F9]")}>{t.count}</span>}
        </button>
      ))}
      {right && <div className="ml-auto pb-1.5 flex items-center gap-2">{right}</div>}
    </div>
  );
}

/** A right-hand panel over the page (Esc or a click outside closes it). */
export function SidePanel({
  title,
  subtitle,
  onClose,
  actions,
  width = "md",
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  actions?: React.ReactNode;
  width?: "md" | "lg" | "xl";
  children: React.ReactNode;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const w = width === "xl" ? "max-w-5xl" : width === "lg" ? "max-w-3xl" : "max-w-xl";
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-[rgba(15,23,42,.28)]" onClick={onClose} />
      <div className={cx("relative h-full w-full bg-[#F4F6FA] shadow-2xl flex flex-col", w)}>
        <div className="bg-white border-b border-[#E3E8EF] px-5 py-3 space-y-2">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-[16px] font-semibold text-[#111827] truncate">{title}</div>
              {subtitle && <div className="text-xs text-[#6B7280] truncate mt-0.5">{subtitle}</div>}
            </div>
            <button onClick={onClose} aria-label="Close" className="text-[#6B7280] hover:text-[#111827] p-1 rounded-md hover:bg-[#F1F4F9]">
              <X className="w-5 h-5" />
            </button>
          </div>
          {actions}
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

/** A labelled form field. */
export function Field({ label, hint, className, children }: { label: React.ReactNode; hint?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <label className={cx("flex flex-col gap-1 min-w-0", className)}>
      <span className="text-[11.5px] font-medium text-[#4B5563]">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-[#9CA3AF]">{hint}</span>}
    </label>
  );
}
export const inputCls = "w-full border border-[#CBD5E1] rounded-lg px-3 py-2 text-[13px] bg-white";

/** Nothing here yet. */
export function Empty({ icon, title, hint, action }: { icon?: React.ReactNode; title: React.ReactNode; hint?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="py-14 px-6 text-center flex flex-col items-center gap-2">
      {icon && <div className="w-12 h-12 rounded-full bg-[#EAF0F8] text-[#24539B] flex items-center justify-center [&>svg]:w-6 [&>svg]:h-6">{icon}</div>}
      <div className="text-[14px] font-medium text-[#1F2937]">{title}</div>
      {hint && <div className="text-[12.5px] text-[#6B7280] max-w-sm">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
