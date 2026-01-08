#!/usr/bin/env python3
"""
ICON Meals — AI Blog Post Importer (one-time)

Run:
  export SHOPIFY_STORE_DOMAIN="icon-meals-dev.myshopify.com"
  export SHOPIFY_API_VERSION="2025-10"
  export SHOPIFY_ADMIN_ACCESS_TOKEN=os.getenv("SHOPIFY_ADMIN_ACCESS_TOKEN", "")
  python3 import_ai_blog_posts.py --dry-run
  python3 import_ai_blog_posts.py --limit 2
  python3 import_ai_blog_posts.py
"""

import argparse
import csv
import json
import os
import sys
import time
from typing import Any, Dict, List, Optional

import requests


# --- GEO blog constants ---
BLOG_TITLE = "AI Knowledge Base"
BLOG_HANDLE = "ai-optimized"
BLOG_TEMPLATE_SUFFIX = "ai-optimized"


# --- GraphQL documents ---
BLOG_QUERY = """
query BlogByHandle($query: String!) {
  blogs(first: 1, query: $query) {
    nodes {
      id
      handle
      title
      templateSuffix
    }
  }
}
"""

BLOG_CREATE = """
mutation BlogCreate($blog: BlogCreateInput!) {
  blogCreate(blog: $blog) {
    blog {
      id
      handle
      title
      templateSuffix
    }
    userErrors {
      field
      message
    }
  }
}
"""

# IMPORTANT: Top-level articles query supports query filters like handle: and blog_id:
# https://shopify.dev/docs/api/admin-graphql/latest/queries/articles :contentReference[oaicite:1]{index=1}
ARTICLES_QUERY = """
query ArticlesByQuery($query: String!) {
  articles(first: 1, query: $query) {
    nodes {
      id
      handle
    }
  }
}
"""

ARTICLE_CREATE = """
mutation ArticleCreate($article: ArticleCreateInput!) {
  articleCreate(article: $article) {
    article {
      id
      handle
      title
    }
    userErrors {
      field
      message
    }
  }
}
"""


def die(msg: str, code: int = 1) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


def env_required(name: str) -> str:
    val = os.getenv(name, "").strip()
    if not val:
        die(f"Missing required environment variable: {name}")
    return val


def env_optional(name: str, default: str) -> str:
    val = os.getenv(name, "").strip()
    return val if val else default


def shopify_graphql(
    store_domain: str,
    api_version: str,
    access_token: str,
    query: str,
    variables: Dict[str, Any],
    *,
    max_retries: int = 6,
) -> Dict[str, Any]:
    """
    Shopify Admin GraphQL POST with basic retry/backoff.
    """
    url = f"https://{store_domain}/admin/api/{api_version}/graphql.json"
    headers = {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": access_token,
    }
    payload = {"query": query, "variables": variables}

    backoff = 1.0
    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.post(url, headers=headers, data=json.dumps(payload), timeout=45)

            if resp.status_code in (429, 500, 502, 503, 504):
                if attempt == max_retries:
                    resp.raise_for_status()
                time.sleep(backoff)
                backoff = min(backoff * 2, 20)
                continue

            resp.raise_for_status()
            data = resp.json()

            if data.get("errors"):
                msg = json.dumps(data["errors"])
                # retry on throttling surfaced via GraphQL errors
                if "throttled" in msg.lower() or "throttle" in msg.lower():
                    if attempt == max_retries:
                        raise RuntimeError(f"GraphQL throttled: {msg}")
                    time.sleep(backoff)
                    backoff = min(backoff * 2, 20)
                    continue
                raise RuntimeError(f"GraphQL errors: {msg}")

            return data

        except (requests.RequestException, ValueError) as exc:
            if attempt == max_retries:
                raise
            time.sleep(backoff)
            backoff = min(backoff * 2, 20)

    raise RuntimeError("Exhausted retries unexpectedly.")


def ensure_csv_headers(csv_path: str, required: List[str]) -> None:
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        headers = next(reader, None)
        if not headers:
            die(f"CSV appears empty: {csv_path}")
        missing = [h for h in required if h not in headers]
        if missing:
            die(f"CSV missing required headers: {missing}. Found headers: {headers}")


def numeric_id_from_gid(gid: str) -> int:
    # Blog id will look like gid://shopify/Blog/123456789
    try:
        return int(gid.rsplit("/", 1)[-1])
    except Exception as exc:
        raise RuntimeError(f"Could not parse numeric id from gid: {gid}") from exc


def get_or_create_blog(
    store_domain: str,
    api_version: str,
    access_token: str,
    dry_run: bool,
) -> Optional[Dict[str, Any]]:
    # Lookup by handle
    variables = {"query": f"handle:{BLOG_HANDLE}"}
    res = shopify_graphql(store_domain, api_version, access_token, BLOG_QUERY, variables)
    nodes = res["data"]["blogs"]["nodes"]
    if nodes:
        blog = nodes[0]
        print(
            f"Using existing blog '{blog['title']}' (handle '{blog['handle']}', templateSuffix '{blog.get('templateSuffix')}')."
        )
        return blog

    if dry_run:
        print(
            f"DRY RUN: Would create blog '{BLOG_TITLE}' (handle '{BLOG_HANDLE}', templateSuffix '{BLOG_TEMPLATE_SUFFIX}')."
        )
        return None

    # Create
    variables = {
        "blog": {
            "title": BLOG_TITLE,
            "handle": BLOG_HANDLE,
            "templateSuffix": BLOG_TEMPLATE_SUFFIX,
        }
    }
    res = shopify_graphql(store_domain, api_version, access_token, BLOG_CREATE, variables)
    errs = res["data"]["blogCreate"]["userErrors"]
    if errs:
        raise RuntimeError(f"Blog create userErrors: {errs}")

    blog = res["data"]["blogCreate"]["blog"]
    print(
        f"Created blog '{blog['title']}' (handle '{blog['handle']}', templateSuffix '{blog.get('templateSuffix')}')."
    )
    return blog


def article_exists(
    store_domain: str,
    api_version: str,
    access_token: str,
    blog_gid: str,
    handle: str,
) -> bool:
    blog_id_num = numeric_id_from_gid(blog_gid)

    # Shopify search syntax uses space as AND; blog_id is a documented filter for articles :contentReference[oaicite:2]{index=2}
    q = f"handle:{handle} blog_id:{blog_id_num}"
    variables = {"query": q}
    res = shopify_graphql(store_domain, api_version, access_token, ARTICLES_QUERY, variables)
    nodes = res["data"]["articles"]["nodes"]
    return len(nodes) > 0


def create_article(
    store_domain: str,
    api_version: str,
    access_token: str,
    blog_gid: str,
    row: Dict[str, str],
    dry_run: bool,
) -> None:
    handle = (row.get("Handle") or "").strip()
    title = (row.get("Title") or "").strip()
    body_html = row.get("Body HTML") or ""

    if not handle or not title or not body_html:
        raise RuntimeError("CSV row missing Handle/Title/Body HTML")

    published = (row.get("Published") or "").strip().upper() == "TRUE"
    template_suffix = (row.get("Template Suffix") or "").strip() or BLOG_TEMPLATE_SUFFIX
    author = (row.get("Author") or "ICON Meals").strip() or "ICON Meals"

    tags_raw = row.get("Tags") or ""
    tags = [t.strip() for t in tags_raw.split(",") if t.strip()]

    article_input: Dict[str, Any] = {
        "blogId": blog_gid,
        "handle": handle,
        "title": title,
        "author": {"name": author},
        "body": body_html,
        "tags": tags,
        "isPublished": published,
        "templateSuffix": template_suffix,  # ArticleCreateInput supports templateSuffix :contentReference[oaicite:3]{index=3}
    }

    if dry_run:
        print(f"DRY RUN: Would create article '{handle}'.")
        return

    variables = {"article": article_input}
    res = shopify_graphql(store_domain, api_version, access_token, ARTICLE_CREATE, variables)
    errs = res["data"]["articleCreate"]["userErrors"]
    if errs:
        raise RuntimeError(f"userErrors: {errs}")

    print(f"CREATED: Article '{handle}'.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Import AI blog articles into Shopify.")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes (no mutations).")
    parser.add_argument("--limit", type=int, default=None, help="Only process first N rows.")
    parser.add_argument("--csv", type=str, default="./icon_ai_import.csv", help="Path to CSV file.")
    args = parser.parse_args()

    store_domain = env_required("SHOPIFY_STORE_DOMAIN")
    access_token = env_required("SHOPIFY_ADMIN_ACCESS_TOKEN")
    api_version = env_optional("SHOPIFY_API_VERSION", "2025-10")

    csv_path = args.csv

    ensure_csv_headers(
        csv_path,
        required=["Handle", "Title", "Blog", "Author", "Body HTML", "Tags", "Published", "Template Suffix"],
    )

    blog = get_or_create_blog(store_domain, api_version, access_token, args.dry_run)
    blog_gid = blog["id"] if blog else None

    created: List[str] = []
    skipped: List[str] = []
    failed: List[str] = []

    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for idx, row in enumerate(reader, start=1):
            if args.limit is not None and idx > args.limit:
                break

            handle = (row.get("Handle") or "").strip()
            if not handle:
                failed.append("(missing handle)")
                print("FAILED: Missing handle.")
                continue

            # If dry-run and blog doesn't exist yet, print preview
            if not blog_gid:
                print(f"DRY RUN: Would create article '{handle}' (after blog creation).")
                created.append(handle)
                continue

            try:
                if article_exists(store_domain, api_version, access_token, blog_gid, handle):
                    print(f"SKIP: Article '{handle}' already exists.")
                    skipped.append(handle)
                    continue

                create_article(store_domain, api_version, access_token, blog_gid, row, args.dry_run)
                created.append(handle)

            except Exception as exc:  # noqa: BLE001
                print(f"FAILED: Article '{handle}' error: {exc}")
                failed.append(handle)

    print("\nSummary:")
    print(f"Created: {len(created)}")
    print(f"Skipped: {len(skipped)}")
    print(f"Failed: {len(failed)}")
    if failed:
        print(f"Failed handles: {failed}")


if __name__ == "__main__":
    main()
