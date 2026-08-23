import { Navigate } from 'react-router';

/**
 * Legacy compatibility boundary for the former standalone statistics page.
 * The useful overview belongs on Início; old links return there.
 */
export default function Details() {
  return <Navigate to="/app" replace />;
}
