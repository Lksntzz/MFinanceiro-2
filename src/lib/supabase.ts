
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 
  (import.meta as any).env.VITE_SUPABASE_URL || 
  (import.meta as any).env.SUPABASE_URL || 
  'https://ckpqoqwvnltmbvyqmmme.supabase.co';

const supabaseAnonKey = 
  (import.meta as any).env.VITE_SUPABASE_ANON_KEY || 
  (import.meta as any).env.SUPABASE_ANON_KEY || 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNrcHFvcXd2bmx0bWJ2eXFtbW1lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1NjI2NDgsImV4cCI6MjA5MTEzODY0OH0.mlVom68ohDU4A4AjHHsAeCdzlIW6f_7A_G7JANBPfno';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Helper to check if configured
export const isSupabaseConfigured = () => {
  return supabaseUrl && 
         supabaseAnonKey && 
         !supabaseUrl.includes('placeholder-project') && 
         !supabaseUrl.includes('your-project') &&
         supabaseAnonKey !== 'placeholder-key' &&
         supabaseAnonKey !== 'your-anon-key';
};
