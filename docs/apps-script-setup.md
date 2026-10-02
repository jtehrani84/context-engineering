# Google Apps Script Setup Guide

Get Apps Script working with Claude Code in 15 minutes. Automate Slides, Sheets, Docs, and Gmail from your terminal.

## Why Apps Script?

If you work in Google Workspace, Apps Script is worth setting up. Apps Script lets Claude:
- Generate slide decks from account data
- Pull Sheets data into briefings
- Automate doc formatting and distribution
- Send templated emails with merge fields
- Build custom Workspace add-ons

## Prerequisites

- A Google account (work or personal)
- Node.js installed (the CLI check already verified this)

## Setup (10 minutes)

### 1. Install clasp

```bash
npm install -g @google/clasp
```

### 2. Login

```bash
clasp login
```

This opens a browser for Google OAuth. Authorize and you're authenticated.

### 3. Create your first project

```bash
mkdir ~/my-apps-script && cd ~/my-apps-script
clasp create --type standalone --title "Claude Automation"
```

This creates two files:
- `.clasp.json` — project ID and root directory
- `appsscript.json` — project manifest (runtime, scopes, etc.)

### 4. Enable the Apps Script API

Go to https://script.google.com/home/usersettings and turn ON "Google Apps Script API". Without this, clasp can't push code.

## Project Types

| Type | Use Case | Create Command |
|------|----------|----------------|
| `standalone` | General automation, utilities | `clasp create --type standalone` |
| `sheets` | Bound to a specific Sheet | `clasp create --type sheets --title "My Sheet"` |
| `docs` | Bound to a specific Doc | `clasp create --type docs --title "My Doc"` |
| `slides` | Bound to a specific Slides deck | `clasp create --type slides --title "My Deck"` |
| `webapp` | HTTP endpoint (GET/POST) | `clasp create --type webapp` |

## The Push vs Deploy Gotcha

This is the #1 source of confusion. Two operations, very different effects:

| Command | What It Does | When to Use |
|---------|-------------|-------------|
| `clasp push` | Uploads source files to the project | Every code change |
| `clasp deploy` | Creates a versioned, callable deployment | When you need the web app URL to serve new code |

**The trap:** `clasp push` updates the source but does NOT update what the web app URL serves. The web app serves from a pinned deployment version, not from HEAD.

### After every code change that should be live:

```bash
# 1. Push the code
clasp push

# 2. Create a new deployment
clasp deploy -d "Added account brief template"

# 3. Note the deployment ID from output — that's your new web app URL
# https://script.google.com/macros/s/{DEPLOYMENT_ID}/exec
```

### Deployment limit

Google allows 20 active deployments per project. If you hit the limit:

```bash
# List deployments
clasp deployments

# Remove an old one
clasp undeploy {OLD_DEPLOYMENT_ID}

# Then create the new one
clasp deploy -d "description"
```

## Scopes

Apps Script requests OAuth scopes based on what APIs your code uses. If you need to control scopes explicitly, edit `appsscript.json`:

```json
{
  "timeZone": "America/New_York",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/presentations",
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/gmail.send"
  ]
}
```

Only request scopes you actually use. Fewer scopes = easier auth approval.

## Working with Claude

Tell Claude what you want to automate. Examples:

- "Build an Apps Script that reads a Sheet of account names and creates a Slides deck with one slide per account"
- "Write a script that sends a weekly email summary from this Sheet"
- "Create a Docs template that fills in company name, revenue, and industry from a Sheet row"

Claude will write the `.gs` files, you push them with clasp.

### Claude + clasp workflow

```
You describe the automation
    → Claude writes the .gs code
        → clasp push (upload)
            → clasp deploy (if web app)
                → Test in browser or via URL
                    → Iterate
```

## Starter Templates

See `templates/apps-script/` for ready-to-use scripts:

| Template | What It Does |
|----------|-------------|
| `slides-from-sheet.gs` | Reads Sheet rows, generates a Slides deck with one slide per row |
| `sheet-data-puller.gs` | HTTP endpoint that returns Sheet data as JSON |
| `email-merge.gs` | Sends personalized emails from a Sheet of contacts |

## Troubleshooting

**"Script function not found"**
You pushed but didn't deploy. Run `clasp deploy`.

**"Authorization required"**
Open the script in the browser (`clasp open`), run any function manually once to trigger the OAuth consent screen.

**"Exceeded maximum number of deployments"**
Run `clasp deployments`, pick old ones to `clasp undeploy`.

**"clasp push" says "No files to push"**
Check `.clasp.json` — the `rootDir` must point to your source directory. Default is `.` (current dir).

**CORS errors calling the web app**
Deploy as "Execute as: Me" and "Who has access: Anyone". For internal-only, use "Anyone within [org]".

## Security Notes

- Never store API keys or secrets in Apps Script source — use PropertiesService
- Web apps default to your identity — callers get YOUR permissions
- Bound scripts inherit the parent doc's sharing permissions
- Review OAuth scopes before deploying to production
