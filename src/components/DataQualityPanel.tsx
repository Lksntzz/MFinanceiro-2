import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';
import { useNavigate } from 'react-router';

import type { DataQualityIssue } from '../lib/financial-quality';

export default function DataQualityPanel({
  issues,
  compact = false,
}: {
  issues: DataQualityIssue[];
  compact?: boolean;
}) {
  const navigate = useNavigate();
  if (!issues.length) {
    return (
      <article
        className={`mf-card mf-data-quality ${compact ? 'compact' : ''}`}
      >
        <CheckCircle2 size={18} />
        <div>
          <strong>Base financeira consistente</strong>
          <p>
            O MF não encontrou pendências relevantes nos dados usados pelas
            análises.
          </p>
        </div>
      </article>
    );
  }

  return (
    <article className={`mf-card mf-data-quality ${compact ? 'compact' : ''}`}>
      <div className="mf-data-quality-heading">
        <span>
          <ShieldCheck size={17} />
          <strong>Qualidade dos dados</strong>
        </span>
        <small>
          {issues.length} ponto{issues.length === 1 ? '' : 's'} para revisar
        </small>
      </div>
      <div className="mf-data-quality-list">
        {issues.slice(0, compact ? 2 : 4).map((issue) => (
          <button
            key={issue.id}
            type="button"
            onClick={() => navigate(issue.actionPath)}
            className={`severity-${issue.severity}`}
          >
            <AlertTriangle size={14} />
            <span>
              <strong>{issue.title}</strong>
              <small>{issue.description}</small>
            </span>
            <span className="mf-data-quality-action">
              {issue.actionLabel}
              <ChevronRight size={13} />
            </span>
          </button>
        ))}
      </div>
    </article>
  );
}
