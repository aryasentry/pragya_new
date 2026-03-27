type MetricCardProps = {
  label: string;
  value: string | number;
  helper?: string;
};

export function MetricCard({ label, value, helper }: MetricCardProps) {
  return (
    <article className="kpi-card ui-metric-card">
      <p>{label}</p>
      <strong>{value}</strong>
      {helper ? <span>{helper}</span> : null}
    </article>
  );
}
