// candidate pool for scripts/discover-companies.mjs, independent of the Y
// Combinator dataset (see discover-yc-pool below in that script) - the board
// was skewing YC-only because that was the ONLY discovery source, which
// also skews small/early-stage/engineering-heavy and under-represents
// non-SWE roles (product, ops, support, network/infra) that a broader set
// of established companies actually posts.
//
// every entry here is a GUESS at a company's board token, not a verified
// claim - discover-companies.mjs tests each one live against Greenhouse/
// Lever/Ashby's real APIs and only keeps what actually resolves. a wrong
// guess just 404s and gets discarded; nothing here reaches the live board
// without a real API hit. slugs are best-effort (usually the lowercased,
// hyphen-stripped company name), deliberately not hand-verified one-by-one
// before adding - that verification is exactly what the discovery script
// does at scale, which is the point of feeding it a large candidate list
// instead of hand-curating seed-companies.ts entries one at a time.
//
// picked for industry/role diversity, not just "well-known tech company":
// several are here specifically because they run real network/infra teams
// (Cloudflare, Fastly, DigitalOcean, Equinix) or large product/ops/support
// orgs (Shopify, DoorDash, Reddit, Zendesk), not just engineering.
export interface KnownCompanyCandidate {
	name: string;
	slug: string;
}

export const KNOWN_COMPANIES_POOL: KnownCompanyCandidate[] = [
	// infra / networking / cloud - for network/infra/sysadmin-type roles
	{ name: 'Cloudflare', slug: 'cloudflare' },
	{ name: 'Fastly', slug: 'fastly' },
	{ name: 'DigitalOcean', slug: 'digitalocean' },
	{ name: 'Vultr', slug: 'vultr' },
	{ name: 'Equinix', slug: 'equinix' },
	{ name: 'Backblaze', slug: 'backblaze' },
	{ name: 'Wasabi Technologies', slug: 'wasabi' },
	{ name: 'HashiCorp', slug: 'hashicorp' },
	{ name: 'Elastic', slug: 'elastic' },
	{ name: 'Confluent', slug: 'confluent' },
	{ name: 'MongoDB', slug: 'mongodb' },
	{ name: 'Datadog', slug: 'datadog' },
	{ name: 'PagerDuty', slug: 'pagerduty' },
	{ name: 'CircleCI', slug: 'circleci' },
	{ name: 'LaunchDarkly', slug: 'launchdarkly' },
	{ name: 'Snyk', slug: 'snyk' },
	{ name: 'Sentry', slug: 'sentry' },
	{ name: 'Twilio', slug: 'twilio' },
	{ name: 'Okta', slug: 'okta' },
	{ name: 'Auth0', slug: 'auth0' },
	{ name: '1Password', slug: '1password' },
	{ name: 'Cloudinary', slug: 'cloudinary' },
	{ name: 'New Relic', slug: 'newrelic' },
	{ name: 'GitBook', slug: 'gitbook' },
	{ name: 'Postman', slug: 'postman' },

	// fintech - large support/ops/compliance orgs, not just engineering
	{ name: 'Chime', slug: 'chime' },
	{ name: 'SoFi', slug: 'sofi' },
	{ name: 'Affirm', slug: 'affirm' },
	{ name: 'Klarna', slug: 'klarna' },
	{ name: 'Wise', slug: 'wise' },
	{ name: 'Revolut', slug: 'revolut' },
	{ name: 'Brex', slug: 'brex' },
	{ name: 'Mercury', slug: 'mercury' },
	{ name: 'Plaid', slug: 'plaid' },
	{ name: 'Marqeta', slug: 'marqeta' },
	{ name: 'Robinhood', slug: 'robinhood' },
	{ name: 'Carta', slug: 'carta' },
	{ name: 'Gusto', slug: 'gusto' },
	{ name: 'Rippling', slug: 'rippling' },
	{ name: 'Justworks', slug: 'justworks' },

	// consumer / e-commerce / marketplace - product, ops, support-heavy
	{ name: 'Shopify', slug: 'shopify' },
	{ name: 'Instacart', slug: 'instacart' },
	{ name: 'DoorDash', slug: 'doordash' },
	{ name: 'Faire', slug: 'faire' },
	{ name: 'Squarespace', slug: 'squarespace' },
	{ name: 'Etsy', slug: 'etsy' },
	{ name: 'Wayfair', slug: 'wayfair' },
	{ name: 'Peloton', slug: 'peloton' },
	{ name: 'Warby Parker', slug: 'warbyparker' },
	{ name: 'Allbirds', slug: 'allbirds' },
	{ name: 'Bird', slug: 'bird' },
	{ name: 'Turo', slug: 'turo' },
	{ name: 'Getaround', slug: 'getaround' },
	{ name: 'Zillow', slug: 'zillow' },
	{ name: 'Redfin', slug: 'redfin' },
	{ name: 'Compass', slug: 'compass' },
	{ name: 'Opendoor', slug: 'opendoor' },

	// media / social / communication
	{ name: 'Reddit', slug: 'reddit' },
	{ name: 'Discord', slug: 'discord' },
	{ name: 'Pinterest', slug: 'pinterest' },
	{ name: 'Lyft', slug: 'lyft' },
	{ name: 'Grammarly', slug: 'grammarly' },
	{ name: 'Duolingo', slug: 'duolingo' },
	{ name: 'Coursera', slug: 'coursera' },
	{ name: 'Udemy', slug: 'udemy' },
	{ name: 'Codecademy', slug: 'codecademy' },
	{ name: 'Calendly', slug: 'calendly' },
	{ name: 'Loom', slug: 'loom' },
	{ name: 'Miro', slug: 'miro' },
	{ name: 'Canva', slug: 'canva' },
	{ name: 'Webflow', slug: 'webflow' },
	{ name: 'Typeform', slug: 'typeform' },

	// productivity / SaaS / support - real PM and CS org headcount
	{ name: 'Notion', slug: 'notion' },
	{ name: 'Airtable', slug: 'airtable' },
	{ name: 'Asana', slug: 'asana' },
	{ name: 'Monday.com', slug: 'monday' },
	{ name: 'Intercom', slug: 'intercom' },
	{ name: 'Zendesk', slug: 'zendesk' },
	{ name: 'Amplitude', slug: 'amplitude' },
	{ name: 'Mixpanel', slug: 'mixpanel' },
	{ name: 'Segment', slug: 'segment' },
	{ name: 'Culture Amp', slug: 'cultureamp' },
	{ name: 'Lattice', slug: 'lattice' },
	{ name: '15Five', slug: '15five' },
	{ name: 'Figma', slug: 'figma' },
	{ name: 'Retool', slug: 'retool' },
	{ name: 'Supabase', slug: 'supabase' },
	{ name: 'PostHog', slug: 'posthog' },
	{ name: 'Replit', slug: 'replit' },
	{ name: 'Vercel', slug: 'vercel' },
	{ name: 'Scale AI', slug: 'scaleai' },
	{ name: 'Perplexity', slug: 'perplexity' },
	{ name: 'Cursor', slug: 'cursor' },
	{ name: 'OpenAI', slug: 'openai' },
	{ name: 'Anthropic', slug: 'anthropic' },
	{ name: 'Databricks', slug: 'databricks' },

	// large-scale / enterprise-adjacent, still ATS-API-friendly
	{ name: 'Stripe', slug: 'stripe' },
	{ name: 'Airbnb', slug: 'airbnb' },
	{ name: 'Cloudflare Inc', slug: 'cloudflareinc' },
	{ name: 'Dropbox', slug: 'dropbox' },
	{ name: 'Box', slug: 'box' },
	{ name: 'Evernote', slug: 'evernote' },
	{ name: 'GitLab Inc', slug: 'gitlabinc' },
	{ name: 'SmartRecruiters', slug: 'smartrecruiters' },
	{ name: 'Workable', slug: 'workable' }
];
