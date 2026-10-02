---
name: reference-example-perishable
description: "Finding about the nightly export script and large orgs. Perishable: re-verify against the current script before acting on it."
metadata:
  type: reference
  last_verified: 2026-09-01
  verified_against:
    artifact: "scripts/export-nightly.sh in the team repo"
    stamp: "commit a1b2c3d, 2026-09-01"
  reverify:
    command: "grep -n 'MAX_OBJECTS' scripts/export-nightly.sh   # confirm the limit is still 50"
---

PERISHABLE. This is a finding about one version of one script, not a lasting fact. Compare the stamp with the script today before relying on any of it.

**Finding:** As of the stamped commit, the nightly export skips any org with more than 50 custom objects and logs a warning instead of failing. Large orgs therefore show up as "exported" with partial data.

**Why it matters:** A dashboard built on this export understates large customers. Check for the skip warning in the job log before trusting a total.

**How to apply:** Run the `reverify` command first. If the limit changed, or the script no longer skips, update this file and its stamp, or delete it. Do not quote the 50-object number to anyone until you have re-run the check.

(Fictional example for this template.)
