import type { ComponentProps, ReactNode } from "react";
import { Slot } from "@radix-ui/react-slot";
import { Layers3 } from "lucide-react";

export function Button({
  asChild,
  tone = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & {
  asChild?: boolean;
  tone?: "primary" | "quiet" | "outline" | "danger";
}) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={`button button-${tone} ${className}`} {...props} />;
}

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Layers3 aria-hidden="true" size={23} />
      </span>
      <div>
        <strong>
          LPStacks<span>.</span>
        </strong>
        <small>LIQUIDITY JOURNAL</small>
      </div>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  children,
  actions,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {children && <p className="subheading">{children}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}

export function Panel({
  title,
  label,
  action,
  children,
}: {
  title: string;
  label?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          {label && <p className="eyebrow">{label}</p>}
          <h2>{title}</h2>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Layers3 size={23} aria-hidden="true" />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warn";
}) {
  return (
    <span className={`badge ${tone}`}>
      <span aria-hidden="true" />
      {children}
    </span>
  );
}
