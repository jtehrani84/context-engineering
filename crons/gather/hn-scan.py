#!/usr/bin/env python3
"""
Hacker News Intelligence Gather — Practitioner sentiment monitoring.

Scrapes HN via the free Algolia API (no auth required). Captures practitioner
perspectives on topics relevant to your work that won't appear in
enterprise news feeds.

Schedule: Daily at 4:45 AM via launchd (after web-scan completes)

Customize QUERIES below for your technology focus and competitive landscape.
"""

import json
import os
import sys
from datetime import datetime, timedelta
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlencode

# === CUSTOMIZE THESE QUERIES ===
# Replace with YOUR technology focus, tools, and interests
QUERIES = [
    {
        "label": "ai_tools",
        "query": "Claude Code AI coding",
        "tags": "story",
        "description": "Practitioner perspective on AI coding tools",
    },
    {
        "label": "ai_agents",
        "query": "AI agents",
        "tags": "story",
        "description": "AI agent architectures and frameworks",
    },
    {
        "label": "developer_productivity",
        "query": "developer productivity tools",
        "tags": "story",
        "description": "Developer workflow and productivity innovations",
    },
    {
        "label": "industry_discussion",
        # Replace with YOUR industry or technology
        "query": "context engineering LLM",
        "tags": "story",
        "description": "Context engineering and LLM best practices",
    },
]

# Output directory
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
RAW_DIR = os.path.join(SCRIPT_DIR, "..", "raw")

# Algolia HN API (free, no auth)
HN_API_URL = "https://hn.algolia.com/api/v1/search"


def search_hn(query_config):
    """Execute a single HN Algolia search."""
    # Last 24 hours
    yesterday_ts = int((datetime.utcnow() - timedelta(days=1)).timestamp())

    params = {
        "query": query_config["query"],
        "tags": query_config.get("tags", "story"),
        "numericFilters": f"created_at_i>{yesterday_ts}",
        "hitsPerPage": 10,
    }

    url = f"{HN_API_URL}?{urlencode(params)}"
    req = Request(url, headers={"User-Agent": "ContextEngineering/1.0"})

    try:
        with urlopen(req, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as e:
        return {"error": f"HTTP {e.code}: {e.reason}"}
    except Exception as e:
        return {"error": str(e)}


def format_results(label, description, results):
    """Format HN results into readable markdown."""
    lines = [f"## {label.replace('_', ' ').title()}"]
    lines.append(f"*{description}*\n")

    if "error" in results:
        lines.append(f"Error: {results['error']}\n")
        return "\n".join(lines)

    hits = results.get("hits", [])
    if not hits:
        lines.append("No stories in the last 24 hours.\n")
        return "\n".join(lines)

    # Sort by points (engagement signal)
    hits.sort(key=lambda x: x.get("points", 0), reverse=True)

    for hit in hits[:5]:  # Top 5 by engagement
        title = hit.get("title", "Untitled")
        url = hit.get("url", "")
        points = hit.get("points", 0)
        comments = hit.get("num_comments", 0)
        author = hit.get("author", "unknown")
        hn_url = f"https://news.ycombinator.com/item?id={hit.get('objectID', '')}"

        lines.append(f"### {title}")
        lines.append(f"- Points: {points} | Comments: {comments} | By: {author}")
        if url:
            lines.append(f"- Link: {url}")
        lines.append(f"- Discussion: {hn_url}")
        lines.append("")

    return "\n".join(lines)


def compute_sentiment_summary(all_hits):
    """Quick sentiment summary based on engagement patterns."""
    total_points = sum(h.get("points", 0) for h in all_hits)
    total_comments = sum(h.get("num_comments", 0) for h in all_hits)
    story_count = len(all_hits)

    if story_count == 0:
        return "No stories found. Quiet day on HN for these topics."

    avg_engagement = total_points / story_count if story_count else 0

    if avg_engagement > 100:
        tone = "High engagement day. Something resonated with the community."
    elif avg_engagement > 30:
        tone = "Moderate discussion. Standard interest level."
    else:
        tone = "Low engagement. These topics are background noise today."

    return f"{story_count} stories, {total_points} total points, {total_comments} comments. {tone}"


def main():
    today = datetime.now().strftime("%Y-%m-%d")

    # Ensure output directory exists
    os.makedirs(RAW_DIR, exist_ok=True)

    output_lines = []
    output_lines.append(f"# HN Intelligence Scan: {today}\n")
    output_lines.append(f"Queries: {len(QUERIES)}")
    output_lines.append(f"Time: {datetime.now().strftime('%H:%M:%S')}")
    output_lines.append(f"Source: Algolia HN API (free, no auth)\n")
    output_lines.append("---\n")

    all_hits = []
    for query_config in QUERIES:
        label = query_config["label"]
        print(f"  Scanning HN: {label}...", file=sys.stderr)

        results = search_hn(query_config)
        formatted = format_results(
            label, query_config["description"], results
        )
        output_lines.append(formatted)

        if "hits" in results:
            all_hits.extend(results["hits"])

    # Add sentiment summary
    output_lines.append("---\n")
    output_lines.append("## Summary")
    output_lines.append(compute_sentiment_summary(all_hits))

    # Write output
    output_path = os.path.join(RAW_DIR, f"hn-{today}.md")
    with open(output_path, "w") as f:
        f.write("\n".join(output_lines))

    print(f"Done. Results written to: {output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
