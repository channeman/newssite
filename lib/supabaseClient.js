import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let supabaseInstance = null;

if (supabaseUrl && supabaseKey) {
  supabaseInstance = createClient(supabaseUrl, supabaseKey);
}

export const supabase = supabaseInstance;
