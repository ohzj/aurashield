// The crisis/harm-reduction exclusion list is the one piece of behavior in
// this codebase that isn't user-configurable, by design - a wellbeing
// filter must not be capable of hiding help someone is actively looking
// for, regardless of what categories they've enabled.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SHIELD_SRC, between } from "./_extract.mjs";

const fnSrc = between(SHIELD_SRC, "const NEVER_SHIELD_HOSTS", "// ---- shared/storage.js");
const scope = {};
new Function("scope", `${fnSrc}\nscope.isNeverShieldHost = isNeverShieldHost;`)(scope);
const { isNeverShieldHost } = scope;

const protectedHosts = [
  "988lifeline.org",
  "www.988lifeline.org",
  "crisistextline.org",
  "chat.crisistextline.org",
  "findtreatment.gov",
  "samhsa.gov",
  "thetrevorproject.org",
  "translifeline.org",
  "poisoncontrol.org",
];

for (const host of protectedHosts) {
  test(`${host} is never shielded, including subdomains`, () => {
    assert.equal(isNeverShieldHost(host), true);
  });
}

test("an ordinary site is not on the never-shield list", () => {
  assert.equal(isNeverShieldHost("www.reddit.com"), false);
  assert.equal(isNeverShieldHost("news.google.com"), false);
});

test("a lookalike domain is not accidentally matched", () => {
  // "notreallythe988lifeline.org" contains the protected domain as a
  // substring but is not a subdomain of it - the check must be a proper
  // suffix match on dot-separated labels, not a bare substring test.
  assert.equal(isNeverShieldHost("notreallythe988lifeline.org"), false);
});
