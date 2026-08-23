// ruleid: mf-no-service-role-on-client
const leakedServiceRole = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

// ruleid: mf-no-service-role-on-client
const leakedAlias = import.meta.env.VITE_SERVICE_ROLE;

// ok: mf-no-service-role-on-client
const publicAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

void leakedServiceRole;
void leakedAlias;
void publicAnonKey;
