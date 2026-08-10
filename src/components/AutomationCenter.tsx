import React from 'react';
import { Navigate } from 'react-router';

/**
 * Compatibility boundary for the former standalone Automation Center.
 * Automation is a behavior of the product and is now reached through the
 * area it affects, with legacy links converging on Conexões.
 */
export default function AutomationCenter() {
  return <Navigate to="/app/integracoes" replace />;
}
