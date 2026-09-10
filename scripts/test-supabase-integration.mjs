import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.JOBFLOW_SUPABASE_URL || "";
const publishableKey = process.env.JOBFLOW_SUPABASE_PUBLISHABLE_KEY || "";

if (!/^http:\/\/127\.0\.0\.1:54321$/.test(supabaseUrl)) {
  throw new Error("Supabase integration test is restricted to http://127.0.0.1:54321");
}
if (!publishableKey) throw new Error("JOBFLOW_SUPABASE_PUBLISHABLE_KEY is required");

const client = createClient(supabaseUrl, publishableKey);
const suffix = Date.now().toString(36);
const email = "integration-" + suffix + "@example.invalid";
const password = "Synthetic-pass-123";

const auth = await client.auth.signUp({ email, password });
if (auth.error || !auth.data.user) throw auth.error || new Error("Synthetic registration failed");

const observed = await client.rpc("observe_job_opportunities", {
  observations: [{
    platform: "liepin",
    platform_job_id: "integration-" + suffix,
    canonical_url: "https://www.liepin.com/job/1.shtml",
    title: "Synthetic integration role",
    company: "Synthetic company",
    location: "Shanghai",
    salary: "20-30k",
    experience: "3 years",
    education: "Bachelor",
    card_text: "Synthetic record"
  }]
});
if (observed.error || !observed.data?.[0]) {
  throw observed.error || new Error("Synthetic observation failed");
}

const opportunity = observed.data[0];
const requestId = crypto.randomUUID();
const invoked = await client.functions.invoke("model-gateway", {
  body: {
    operation: "record_filter",
    requestId,
    route: "byok",
    provider: "openai",
    endpoint: "https://api.openai.com/v1",
    model: "synthetic",
    payload: {
      opportunityId: opportunity.id,
      job: {
        platform: "liepin",
        jobId: "integration-" + suffix,
        url: "https://www.liepin.com/job/1.shtml",
        canonicalUrl: "https://www.liepin.com/job/1.shtml",
        title: "Synthetic integration role",
        company: "Synthetic company",
        location: "Shanghai",
        salary: "20-30k",
        experience: "3 years",
        education: "Bachelor",
        cardText: "Synthetic record",
        index: 0,
        description: "Synthetic description with a mandatory travel requirement.",
        recruiter: "Synthetic recruiter",
        recruiterTitle: "Recruiter"
      },
      filter: {
        outcome: "exclude",
        decisions: [{
          ruleId: "travel_mobility",
          ruleVersion: 1,
          outcome: "exclude",
          reason: "Synthetic deterministic exclusion",
          evidence: [{ text: "mandatory travel requirement", start: 29, end: 57 }]
        }]
      }
    }
  }
});
if (invoked.error || invoked.data?.ok !== true) {
  throw invoked.error || new Error("Synthetic Edge Function invocation failed");
}

const result = await client.from("job_opportunities")
  .select("current_status,latest_reason")
  .eq("id", opportunity.id)
  .single();
if (result.error) throw result.error;
if (result.data.current_status !== "deterministic_excluded"
  || result.data.latest_reason !== "Synthetic deterministic exclusion") {
  throw new Error("Synthetic result did not survive the Function-to-RLS round trip");
}

const blocked = await client.functions.invoke("model-gateway", {
  headers: { "x-jobflow-byok-key": "synthetic-key-never-sent" },
  body: {
    operation: "test_provider",
    requestId: crypto.randomUUID(),
    route: "byok",
    provider: "custom",
    endpoint: "https://localhost/v1",
    model: "synthetic",
    payload: {}
  }
});
if (!blocked.error) throw new Error("Blocked endpoint unexpectedly reached provider processing");
const blockedBody = await blocked.error.context.json();
if (blockedBody?.error?.code !== "blocked_endpoint") {
  throw new Error("Blocked endpoint did not return the expected safe error category");
}

await client.auth.signOut();
console.log("Supabase synthetic integration: PASS");
