/** The install code for one project, built from its public key and this deployment's origin. */
export function installSnippet(
  origin: string,
  publicKey: string,
  consent: "required" | "implied",
) {
  return `<script async src="${origin}/t.js" data-key="${publicKey}" data-consent="${consent}"></script>`;
}

/** The consent call a site's own code makes. */
export function consentSnippet() {
  return `// When the visitor accepts analytics (or on load, if consent is not needed):
window.caldrin("consent", true);`;
}

/** A server-side event, as the customer's backend sends it. */
export function serverEventExample(origin: string) {
  return `curl -X POST ${origin}/api/attribution/events \\
  -H "Authorization: Bearer $CALDRIN_ATTRIBUTION_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{"events":[{
    "event_id": "signup_8f2a",
    "type": "signup",
    "visitor_id": "<the _cldr_vid cookie>",
    "user_id": "user_123",
    "occurred_at": "2026-01-15T10:30:00Z"
  }]}'`;
}
