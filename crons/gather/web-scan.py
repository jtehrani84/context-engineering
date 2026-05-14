#!/usr/bin/env python3
"""
Web Intelligence Gather — Daily automated research scan.

Runs 5 queries against the Exa search API to gather overnight intelligence.
Results are written to crons/raw/ with a date stamp for morning synthesis.

Prerequisites:
- EXA_API_KEY environment variable set
- Or: Exa MCP server configured (this script uses the REST API directly)

Schedule: Daily at 4:30 AM via launchd (see plists/)

Customize QUERIES below for your industry, tools, and competitive landscape.
"""

import json
import os
import sys
from datetime import datetime, timedelta
from urllib.request import Request, urlopen
from urllib.error import HTTPError

# === CUSTOMIZE THESE QUERIES ===
# Replace with YOUR topics, tools, competitors, and focus areas
QUERIES = [
    {
        "label": "primary_tools",
        "query": "Claude Code AI coding assistant new features updates",
        "category": "news",
        "num_results": 5,
        "start_published_date": None,  # Will be set to 24h ago
    },
    {
        "label": "industry_news",
        # Replace with YOUR industry
        "query": "AI agent development production deployment enterprise",
        "category": "news",
        "num_results": 5,
        "start_published_date": None,
    },
    {
        "label": "competing_tools",
        # Replace with tools/approaches competing with yours
        "query": "Cursor OR Windsurf OR GitHub Copilot AI coding update",
        "category": "news",
        "num_results": 5,
        "start_published_date": None,
    },
    {
        "label": "technology_trends",
        # Replace with YOUR technology focus
        "query": "MCP Model Context Protocol servers integrations",
        "category": "research paper",
        "num_results": 3,
        "start_published_date": None,
    },
    {
        "label": "ecosystem",
        # Replace with YOUR ecosystem
        "query": "Anthropic Claude API new capabilities enterprise",
        "category": "tweet",
        "num_results": 5,
        "start_published_date": None,
    },
]

# Output directory (relative to this script's location)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
RAW_DIR = os.path.join(SCRIPT_DIR, "..", "raw")

# Exa API configuration
EXA_API_URL = "https://api.exa.ai/search"


def get_api_key():
    """Get Exa API key from environment."""
    key = os.environ.get("EXA_API_KEY")
    if not key:
        print("ERROR: EXA_API_KEY environment variable not set.", file=sys.stderr)
        print("Get your key at https://exa.ai and set:", file=sys.stderr)
        print("  export EXA_API_KEY='your-key-here'", file=sys.stderr)
        sys.exit(1)
    return key


def search_exa(query_config, api_key):
    """Execute a single Exa search query."""
    # Default to last 24 hours
    yesterday = (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")

    payload = {
        "query": query_config["query"],
        "num_results": query_config.get("num_results", 5),
        "start_published_date": query_config.get("start_published_date") or yesterday,
        "use_autoprompt": True,
        "type": "neural",
    }

    if query_config.get("category"):
        payload["category"] = query_config["category"]

    headers = {
        "Content-Type": "application/json",
        "x-api-key": api_key,
    }

    req = Request(
        EXA_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )

    try:
        with urlopen(req, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as e:
        return {"error": f"HTTP {e.code}: {e.reason}", "query": query_config["query"]}
    except Exception as e:
        return {"error": str(e), "query": query_config["query"]}


def format_results(label, results):
    """Format search results into readable markdown."""
    lines = [f"## {label.replace('_', ' ').title()}\n"]

    if "error" in results:
        lines.append(f"Error: {results['error']}\n")
        return "\n".join(lines)

    hits = results.get("results", [])
    if not hits:
        lines.append("No results found.\n")
        return "\n".join(lines)

    for hit in hits:
        title = hit.get("title", "Untitled")
        url = hit.get("url", "")
        published = hit.get("publishedDate", "")[:10]
        snippet = hit.get("text", "")[:200]

        lines.append(f"### {title}")
        lines.append(f"- URL: {url}")
        if published:
            lines.append(f"- Published: {published}")
        if snippet:
            lines.append(f"- Summary: {snippet}")
        lines.append("")

    return "\n".join(lines)


def main():
    api_key = get_api_key()
    today = datetime.now().strftime("%Y-%m-%d")

    # Ensure output directory exists
    os.makedirs(RAW_DIR, exist_ok=True)

    all_results = []
    all_results.append(f"# Web Intelligence Scan: {today}\n")
    all_results.append(f"Queries run: {len(QUERIES)}")
    all_results.append(f"Time: {datetime.now().strftime('%H:%M:%S')}\n")
    all_results.append("---\n")

    errors = 0
    for query_config in QUERIES:
        label = query_config["label"]
        print(f"  Scanning: {label}...", file=sys.stderr)

        results = search_exa(query_config, api_key)
        formatted = format_results(label, results)
        all_results.append(formatted)

        if "error" in results:
            errors += 1

    # Write output
    output_path = os.path.join(RAW_DIR, f"web-{today}.md")
    with open(output_path, "w") as f:
        f.write("\n".join(all_results))

    print(f"Done. Results written to: {output_path}", file=sys.stderr)
    if errors:
        print(f"  ({errors} queries had errors)", file=sys.stderr)


if __name__ == "__main__":
    main()
