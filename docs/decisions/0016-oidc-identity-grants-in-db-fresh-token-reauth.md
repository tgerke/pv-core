# ADR-0016: OIDC for identity, grants in the database, fresh-token re-authentication for signing

**Status**: accepted · 2026-08-17

## Decision

`AUTH_MODE=oidc` validates bearer JWTs against the identity provider's issuer, audience,
and JWKS; the verified email claim resolves to a `person`, or the request is refused.
Machine identities (client-credentials tokens without an email claim) map to provisioned
people through `API_SERVICE_SUBJECTS`. Authorization is `access_grant` rows in the
database, not IdP roles. Signing a case version requires `reauth_token` in the request
body: a freshly issued token for the same subject with `auth_time` inside
`REAUTH_MAX_AGE_SECONDS` (default 300); method and time are recorded on the signature row
and a database CHECK requires them on every new signature. `AUTH_MODE=dev` keeps static
tokens for the demo and restates the bearer token as its re-authentication stub: API-shape
parity, not a credential challenge.

## Rationale

The port of ctms-core's ADR-0008 and its §11.200 mechanism. 21 CFR 11.200(a)(1)(i) asks
that the first signing in a session use all signature components; a fresh IdP
authentication is the strongest evidence a web application can record for that without
storing passwords. Grants in the database keep authorization auditable with everything
else.

## Consequences

The IdP must honor forced re-authentication (`prompt=login`); Keycloak in clinical-stack
does. Dev mode is a demo affordance and is listed as such in the honest gaps.
