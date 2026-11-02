"use client";

import clsx from "clsx";
import React from "react";

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] leading-snug text-muted">{hint}</p>}
    </div>
  );
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
  className,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label?: string }> | string[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const opts = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  const known = opts.some((o) => o.value === value);
  return (
    <select className={clsx("input", className)} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      {placeholder && <option value="">{placeholder}</option>}
      {!known && value && <option value={value}>{value} (見つかりません)</option>}
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label ?? o.value}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between rounded-md border border-border bg-panel-2 px-2.5 py-1.5 text-sm"
    >
      <span>{label}</span>
      <span className={clsx("relative h-5 w-9 rounded-full transition", checked ? "bg-accent" : "bg-border")}>
        <span className={clsx("absolute top-0.5 h-4 w-4 rounded-full bg-white transition", checked ? "left-4.5" : "left-0.5")} />
      </span>
    </button>
  );
}

/** onClick handler that only fires when the pointer went down on the backdrop itself (not a drag out of a field). */
export function useBackdropClose(onClose: () => void) {
  const downOnBackdrop = React.useRef(false);
  return {
    onMouseDown: (e: React.MouseEvent) => {
      downOnBackdrop.current = e.target === e.currentTarget;
    },
    onClick: (e: React.MouseEvent) => {
      if (downOnBackdrop.current && e.target === e.currentTarget) onClose();
      downOnBackdrop.current = false;
    },
  };
}

export function Modal({ title, onClose, children, width = "max-w-2xl" }: { title: string; onClose: () => void; children: React.ReactNode; width?: string }) {
  const backdrop = useBackdropClose(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" {...backdrop}>
      <div className={clsx("max-h-[90vh] w-full overflow-y-auto rounded-xl border border-border bg-panel p-5 shadow-2xl", width)} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="btn-icon" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function StatusDot({ ok, label, title }: { ok: boolean | undefined; label: string; title?: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted" title={title}>
      <span className={clsx("inline-block h-2 w-2 rounded-full", ok === undefined ? "bg-border" : ok ? "bg-ok" : "bg-danger")} />
      {label}
    </span>
  );
}
