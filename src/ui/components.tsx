import type { ReactNode } from 'react';
import type { ExportFormats } from '../core/types';

export function ProgressBar({ value, max }: { value: number; max: number }) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <div style={{ width: `${percent}%` }} />
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="stat">
      <b>{value}</b>
      <span className="muted small">{label}</span>
    </div>
  );
}

export function FormatPicker({
  value,
  onChange,
  disabled,
}: {
  value: ExportFormats;
  onChange: (value: ExportFormats) => void;
  disabled?: boolean;
}) {
  const toggle = (key: keyof ExportFormats) => onChange({ ...value, [key]: !value[key] });
  return (
    <div className="row">
      <label className="check">
        <input type="checkbox" checked={value.html} disabled={disabled} onChange={() => toggle('html')} />
        HTML viewer
      </label>
      <label className="check">
        <input type="checkbox" checked={value.json} disabled={disabled} onChange={() => toggle('json')} />
        JSON
      </label>
      <label className="check">
        <input type="checkbox" checked={value.csv} disabled={disabled} onChange={() => toggle('csv')} />
        CSV
      </label>
    </div>
  );
}

export function ErrorNotice({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div className="card error" role="alert">
      <span className="danger">{message}</span>
    </div>
  );
}
