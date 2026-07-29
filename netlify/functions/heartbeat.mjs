/**
 * The house's heartbeat: a quiet visit every five minutes so the
 * server never falls asleep — the first guest of the morning is no
 * longer greeted by a five-second yawn (serverless cold start).
 */
export default async () => {
  const site = process.env.NEXT_PUBLIC_SITE_URL || process.env.URL;
  if (!site) return new Response("no site url", { status: 200 });
  try {
    await fetch(`${site}/en/login`, { headers: { "x-house-heartbeat": "1" } });
  } catch {
    // A missed beat is not an emergency; the next one is five minutes away.
  }
  return new Response("beat", { status: 200 });
};

export const config = { schedule: "*/5 * * * *" };
