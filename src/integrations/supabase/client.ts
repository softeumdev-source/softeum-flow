// Cliente Supabase configurado manualmente para o projeto externo do usuário.
// IMPORTANTE: estes valores estão hardcoded propositalmente porque o projeto
// está conectado a um Supabase próprio (não ao Lovable Cloud).
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = "https://arihejdirnhmcwuhkzde.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFyaWhlamRpcm5obWN3dWhremRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3Mzk5MzAsImV4cCI6MjA5MjMxNTkzMH0.JNcv6mm_eNS__TvctUCalot1OcKxIUZPAtkslRya1Cg";

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});
