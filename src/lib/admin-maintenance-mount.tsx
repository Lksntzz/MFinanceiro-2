import React from 'react';
import { createRoot } from 'react-dom/client';
import AdminMaintenanceControl from '../components/AdminMaintenanceControl';

const HOST_ID = 'mf-admin-maintenance-control';

function mountAdminMaintenanceControl() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  document.body.appendChild(host);
  createRoot(host).render(<AdminMaintenanceControl />);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountAdminMaintenanceControl, { once: true });
} else {
  mountAdminMaintenanceControl();
}
