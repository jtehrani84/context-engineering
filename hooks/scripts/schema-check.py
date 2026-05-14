#!/usr/bin/env python3
"""
Schema Validation Hook — PreToolUse on Bash commands.

Generic schema/type validator that checks field names and query structure
BEFORE execution. Prevents the common pattern of: query -> fail -> retry.

This is a TEMPLATE. Customize for your tech stack:
- SQL: validate table/column names against your schema
- GraphQL: validate field names against your schema.graphql
- REST API: validate endpoint paths against your OpenAPI spec
- CLI tools: validate flag names against known options

By default, this validates SQL-style queries against a schema file.
Create ~/.claude/schema.json with your schema definition.

Schema file format:
{
  "tables": {
    "users": ["id", "email", "name", "created_at"],
    "orders": ["id", "user_id", "total", "status", "created_at"]
  }
}
"""

import difflib
import json
import os
import re
import sys
from pathlib import Path


# Schema file location (customize this)
SCHEMA_FILE = Path.home() / ".claude" / "schema.json"

# Load schema if it exists
SCHEMA = {}
if SCHEMA_FILE.exists():
    try:
        with open(SCHEMA_FILE) as f:
            SCHEMA = json.load(f)
    except (json.JSONDecodeError, IOError):
        pass


def extract_sql_info(command: str) -> dict | None:
    """
    Extract table name and fields from a SQL-style query command.
    Returns None if command doesn't contain a query.
    """
    # Check if this looks like a SQL query
    sql_match = re.search(r'\b(SELECT|INSERT|UPDATE|DELETE)\b', command, re.IGNORECASE)
    if not sql_match:
        return None

    # Extract FROM clause
    from_match = re.search(r'\bFROM\s+(\w+)', command, re.IGNORECASE)
    if not from_match:
        return None

    table_name = from_match.group(1)

    # Extract SELECT fields
    select_match = re.search(r'\bSELECT\s+(.+?)\s+FROM\b', command, re.IGNORECASE)
    fields = []
    if select_match:
        field_str = select_match.group(1)
        for f in field_str.split(','):
            f = f.strip()
            if f and f != '*' and '(' not in f:
                # Handle aliases: field AS alias
                f = f.split(' AS ')[0].split(' as ')[0].strip()
                # Handle table.field
                if '.' in f:
                    f = f.split('.')[-1]
                fields.append(f)

    return {
        'table': table_name,
        'fields': fields,
    }


def validate_against_schema(query_info: dict) -> list:
    """Validate table and field names against loaded schema."""
    issues = []
    tables = SCHEMA.get("tables", {})

    table = query_info['table']
    fields = query_info['fields']

    # Check if table exists
    table_lower = {k.lower(): k for k in tables}
    if table.lower() not in table_lower:
        # Try fuzzy match
        matches = difflib.get_close_matches(table, list(tables.keys()), n=3, cutoff=0.6)
        suggestion = f" Did you mean: {', '.join(matches)}?" if matches else ""
        issues.append(f"Table '{table}' not found in schema.{suggestion}")
        return issues

    # Get actual table name and its fields
    actual_table = table_lower[table.lower()]
    valid_fields = tables[actual_table]
    valid_fields_lower = {f.lower(): f for f in valid_fields}

    # Validate each field
    for field in fields:
        if field.lower() not in valid_fields_lower:
            matches = difflib.get_close_matches(field, valid_fields, n=3, cutoff=0.6)
            suggestion = f" Did you mean: {', '.join(matches)}?" if matches else ""
            issues.append(f"Field '{field}' not found on {actual_table}.{suggestion}")

    return issues


def main():
    """Main entry point."""
    # Read hook input
    if sys.stdin.isatty():
        print(json.dumps({"result": "continue"}))
        sys.exit(0)

    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        print(json.dumps({"result": "continue"}))
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    tool_input = hook_input.get("tool_input", {})

    # Only process Bash commands
    if tool_name != "Bash":
        print(json.dumps({"result": "continue"}))
        sys.exit(0)

    command = tool_input.get("command", "") if isinstance(tool_input, dict) else str(tool_input)
    if not command:
        print(json.dumps({"result": "continue"}))
        sys.exit(0)

    # Skip if no schema loaded
    if not SCHEMA:
        print(json.dumps({"result": "continue"}))
        sys.exit(0)

    # Extract query info
    query_info = extract_sql_info(command)
    if not query_info:
        print(json.dumps({"result": "continue"}))
        sys.exit(0)

    # Validate against schema
    issues = validate_against_schema(query_info)

    if issues:
        reason = " | ".join(issues)
        output = {
            "result": "block",
            "reason": f"Schema validation failed: {reason}",
        }
    else:
        output = {"result": "continue"}

    print(json.dumps(output))
    sys.exit(0)


if __name__ == "__main__":
    main()
