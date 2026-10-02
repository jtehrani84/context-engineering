# /gas-deploy

Deploy Google Apps Script code with the full push + deploy + verify workflow. Prevents the #1 clasp gotcha.

## Trigger
When the user says: "deploy apps script", "gas deploy", "push to apps script", "clasp deploy", "update the script"

## Workflow

### 1. Pre-flight checks

Verify the environment:
- `clasp` is installed (`which clasp`)
- `.clasp.json` exists in the working directory (identifies the Apps Script project)
- `appsscript.json` exists (project manifest)
- User is logged in (`clasp login --status`)

If any check fails, give the specific fix command and stop.

### 2. Show what's changing

```bash
clasp status
```

List files that will be pushed. Confirm with the user before proceeding.

### 3. Push the code

```bash
clasp push
```

This uploads source files to the Apps Script project. **This does NOT update the web app.**

### 4. Deploy (if web app)

Ask: "Is this a web app that needs a new deployment? (y/n)"

If yes:
```bash
# Check deployment count
clasp deployments

# If at 20-deployment limit, undeploy the oldest non-HEAD
clasp undeploy {OLDEST_DEPLOYMENT_ID}

# Create new deployment
clasp deploy -d "Deployed via /gas-deploy — $(date +%Y-%m-%d %H:%M)"
```

Capture the new deployment ID from output.

### 5. Verify

```bash
# Open the script in browser to verify
clasp open
```

Report the deployment URL: `https://script.google.com/macros/s/{DEPLOYMENT_ID}/exec`

### 6. Summary

```
## Apps Script Deploy — [Date/Time]
**Project:** [script ID from .clasp.json]
**Files pushed:** [count]
**Deployment:** [new/unchanged]
**Deployment ID:** [ID if new deploy]
**Web app URL:** [URL if applicable]
**Status:** OK
```

## Rules
- NEVER skip the deploy step for web apps — `clasp push` alone is not enough
- If the user says "just push", warn them that web app callers will still get old code
- Always show the deployment ID — it's needed for any service pointing at this script
- If the script uses `doGet()` or `doPost()`, it's a web app and needs deployment
- Check for the 20-deployment limit before creating a new one
- The deploy description should include the date so old deployments are identifiable
