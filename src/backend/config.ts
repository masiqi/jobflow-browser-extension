export interface PublicBackendConfig {
  supabaseUrl: string;
  publishableKey: string;
  configured: boolean;
}

const supabaseUrl = typeof __JOBFLOW_SUPABASE_URL__ === "string"
  ? __JOBFLOW_SUPABASE_URL__
  : "";
const publishableKey = typeof __JOBFLOW_SUPABASE_PUBLISHABLE_KEY__ === "string"
  ? __JOBFLOW_SUPABASE_PUBLISHABLE_KEY__
  : "";

export const BACKEND_CONFIG: PublicBackendConfig = {
  supabaseUrl,
  publishableKey,
  configured: publishableKey.length > 0 && (
    /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)
    || /^http:\/\/127\.0\.0\.1:54321$/i.test(supabaseUrl)
  )
};
