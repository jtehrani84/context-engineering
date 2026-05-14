#!/usr/bin/env python3
"""
GitHub Trending & Release Monitor — Tracks ecosystem adoption and releases.
Uses GitHub API (gh CLI token or unauthenticated for trending).
Writes JSON to crons/raw/ for later synthesis.

Runs via launchd daily at 4:45 AM.

Customize WATCHED_REPOS and SEARCH_QUERIES for your technology stack.
"""

import json
import os
import subprocess
from datetime import datetime, timedelta
import urllib.request

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
RAW_DIR = os.path.join(SCRIPT_DIR, "..", "raw")
TODAY = datetime.now().strftime("%Y-%m-%d")
OUTPUT_FILE = os.path.join(RAW_DIR, f"{TODAY}-github.json")

# === CUSTOMIZE: Repos to monitor for new releases ===
# Replace with repos YOUR work depends on or competes with
WATCHED_REPOS = [
    "anthropics/anthropic-sdk-python",
    "anthropics/claude-code",
    "langchain-ai/langchain",
    "langchain-ai/langgraph",
    "microsoft/autogen",
    "openai/openai-agents-python",
    "vercel/ai",
    "modelcontextprotocol/servers",
]

# === CUSTOMIZE: Search queries for trending/new repos ===
SEARCH_QUERIES = [
    {"query": "AI agent framework", "category": "trending_agent_frameworks"},
    {"query": "MCP server", "category": "trending_mcp"},
    {"query": "developer productivity AI", "category": "trending_devtools"},
]


def get_github_token() -> str:
    """Get token from gh CLI config."""
    try:
        result = subprocess.run(
            ["gh", "auth", "token"],
            capture_output=True, text=True, timeout=5
        )
        return result.stdout.strip() if result.returncode == 0 else ""
    except Exception:
        return ""


def github_api(endpoint: str, token: str = "") -> dict:
    """Call GitHub API."""
    url = f"https://api.github.com{endpoint}"
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "ContextEngineering/1.0"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except Exception as e:
        return {"error": str(e)}


def get_recent_releases(repo: str, token: str) -> list:
    """Get releases from last 7 days for a repo."""
    data = github_api(f"/repos/{repo}/releases?per_page=5", token)
    if isinstance(data, dict) and "error" in data:
        return []

    cutoff = (datetime.now() - timedelta(days=7)).isoformat() + "Z"
    recent = []
    for release in (data if isinstance(data, list) else []):
        published = release.get("published_at", "")
        if published > cutoff:
            recent.append({
                "repo": repo,
                "tag": release.get("tag_name", ""),
                "name": release.get("name", ""),
                "published_at": published,
                "url": release.get("html_url", ""),
                "body_snippet": release.get("body", "")[:300],
            })
    return recent


def search_repos(query: str, token: str, num_results: int = 5) -> list:
    """Search for recently created/updated repos."""
    cutoff = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
    encoded = urllib.request.quote(f"{query} pushed:>{cutoff}")
    data = github_api(f"/search/repositories?q={encoded}&sort=stars&per_page={num_results}", token)

    if isinstance(data, dict) and "error" in data:
        return [data]

    items = data.get("items", []) if isinstance(data, dict) else []
    return [
        {
            "name": r.get("full_name", ""),
            "description": (r.get("description", "") or "")[:200],
            "stars": r.get("stargazers_count", 0),
            "url": r.get("html_url", ""),
            "language": r.get("language", ""),
            "pushed_at": r.get("pushed_at", ""),
        }
        for r in items
    ]


def main():
    os.makedirs(RAW_DIR, exist_ok=True)
    token = get_github_token()

    # Monitor releases on watched repos
    all_releases = []
    for repo in WATCHED_REPOS:
        releases = get_recent_releases(repo, token)
        all_releases.extend(releases)

    # Search for trending repos
    search_results = {}
    for sq in SEARCH_QUERIES:
        hits = search_repos(sq["query"], token)
        search_results[sq["category"]] = {
            "query": sq["query"],
            "results": [r for r in hits if "error" not in r],
            "errors": [r["error"] for r in hits if "error" in r],
        }

    output = {
        "fetched_at": datetime.now().isoformat(),
        "recent_releases": all_releases,
        "release_count": len(all_releases),
        "trending": search_results,
        "trending_total": sum(len(v["results"]) for v in search_results.values()),
    }

    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2)

    print(f"Wrote {output['release_count']} releases + {output['trending_total']} trending to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
