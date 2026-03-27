import { ReactNode } from "react";

type PanelProps = {
  title?: string;
  subtitle?: string;
  className?: string;
  children: ReactNode;
};

export function Panel({ title, subtitle, className, children }: PanelProps) {
  return (
    <section className={`panel ui-panel ${className ?? ""}`.trim()}>
      {title ? (
        <header className="ui-panel-header">
          <h3>{title}</h3>
          {subtitle ? <p>{subtitle}</p> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}
