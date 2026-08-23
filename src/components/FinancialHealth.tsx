import { Navigate } from 'react-router';

/**
 * Legacy compatibility boundary.
 *
 * The old 0–1000 financial-health score is intentionally retired. Historical
 * financial data remains untouched; old routes are redirected to Insights.
 */
export default function FinancialHealth() {
  return <Navigate to="/app/analises/insights" replace />;
}
