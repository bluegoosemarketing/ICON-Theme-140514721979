#!/usr/bin/env python3
"""
README: Run with `python3 import_ai_blog_posts.py [--dry-run] [--limit N]`
"""

import argparse
import csv
import json
from typing import Any, Dict, List, Optional

import requests

SHOPIFY_STORE_DOMAIN = "REPLACE_WITH_YOUR_STORE.myshopify.com"
SHOPIFY_API_VERSION = "2025-10"
SHOPIFY_ADMIN_ACCESS_TOKEN = "REPLACE_WITH_YOUR_shpat_TOKEN"

CSV_PATH = "./icon_ai_import.csv"


def shopify_graphql(query: str, variables: Dict[str, Any]) -> Dict[str, Any]:
    url = (
        f"https://{SHOPIFY_STORE_DOMAIN}/admin/api/"
        f"{SHOPIFY_API_VERSION}/graphql.json"
    )
    headers = {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_ACCESS_TOKEN,
    }
    response = requests.post(
        url, headers=headers, data=json.dumps({"query": query, "variables": variables})
    )
    response.raise_for_status()
    payload = response.json()
    if payload.get("errors"):
        raise RuntimeError(f"GraphQL errors: {payload['errors']}")
    return payload


BLOG_TITLE = "AI Knowledge Base"
BLOG_HANDLE = "ai-optimized"
BLOG_TEMPLATE_SUFFIX = "ai-optimized"

BLOG_QUERY = """
query BlogByHandle($query: String!) {
  blogs(first: 1, query: $query) {
    nodes {
      id
      handle
      title
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
    }
    userErrors {
      field
      message
    }
  }
}
"""

ARTICLE_QUERY = """
query ArticleByHandle($blogId: ID!, $query: String!) {
  blog(id: $blogId) {
    id
    articles(first: 1, query: $query) {
      nodes {
        id
        handle
      }
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


def get_blog() -> Optional[Dict[str, Any]]:
    variables = {"query": f"handle:{BLOG_HANDLE}"}
    result = shopify_graphql(BLOG_QUERY, variables)
    nodes = result["data"]["blogs"]["nodes"]
    return nodes[0] if nodes else None


def create_blog(dry_run: bool) -> Optional[Dict[str, Any]]:
    if dry_run:
        print(
            f"DRY RUN: Would create blog '{BLOG_TITLE}' "
            f"(handle '{BLOG_HANDLE}', template '{BLOG_TEMPLATE_SUFFIX}')."
        )
        return None
    variables = {
        "blog": {
            "title": BLOG_TITLE,
            "handle": BLOG_HANDLE,
            "templateSuffix": BLOG_TEMPLATE_SUFFIX,
        }
    }
    result = shopify_graphql(BLOG_CREATE, variables)
    user_errors = result["data"]["blogCreate"]["userErrors"]
    if user_errors:
        raise RuntimeError(f"Blog create userErrors: {user_errors}")
    return result["data"]["blogCreate"]["blog"]


def article_exists(blog_id: str, handle: str) -> bool:
    variables = {"blogId": blog_id, "query": f"handle:{handle}"}
    result = shopify_graphql(ARTICLE_QUERY, variables)
    nodes = result["data"]["blog"]["articles"]["nodes"]
    return len(nodes) > 0


def create_article(
    blog_id: str,
    row: Dict[str, str],
    dry_run: bool,
) -> Dict[str, Any]:
    article_input = {
        "blogId": blog_id,
        "handle": row["Handle"],
        "title": row["Title"],
        "authorName": row["Author"],
        "bodyHtml": row["Body HTML"],
        "tags": [tag.strip() for tag in row["Tags"].split(",") if tag.strip()],
        "isPublished": row["Published"] == "TRUE",
        "templateSuffix": row["Template Suffix"],
    }

    if dry_run:
        print(f"DRY RUN: Would create article '{row['Handle']}'.")
        return {"article": {"handle": row["Handle"]}, "userErrors": []}

    variables = {"article": article_input}
    result = shopify_graphql(ARTICLE_CREATE, variables)
    return result["data"]["articleCreate"]


def main() -> None:
    parser = argparse.ArgumentParser(description="Import blog articles into Shopify.")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes.")
    parser.add_argument("--limit", type=int, default=None, help="Limit rows.")
    args = parser.parse_args()

    blog = get_blog()
    if not blog:
        blog = create_blog(args.dry_run)
        if blog:
            print(
                f"Created blog '{blog['title']}' (handle '{blog['handle']}')."
            )
    else:
        print(f"Using existing blog '{blog['title']}' (handle '{blog['handle']}').")

    blog_id = blog["id"] if blog else None

    created: List[str] = []
    skipped: List[str] = []
    failed: List[str] = []

    with open(CSV_PATH, newline="", encoding="utf-8") as csvfile:
        reader = csv.DictReader(csvfile)
        for index, row in enumerate(reader, start=1):
            if args.limit and index > args.limit:
                break

            handle = row.get("Handle", "").strip()
            if not handle:
                failed.append("(missing handle)")
                print("FAILED: Missing handle.")
                continue

            if not blog_id:
                print(
                    f"DRY RUN: Would create article '{handle}' "
                    f"after creating blog '{BLOG_HANDLE}'."
                )
                created.append(handle)
                continue

            try:
                if article_exists(blog_id, handle):
                    print(f"SKIP: Article '{handle}' already exists.")
                    skipped.append(handle)
                    continue

                result = create_article(blog_id, row, args.dry_run)
                user_errors = result.get("userErrors", [])
                if user_errors:
                    print(f"FAILED: Article '{handle}' userErrors: {user_errors}")
                    failed.append(handle)
                    continue

                print(f"CREATED: Article '{handle}'.")
                created.append(handle)
            except Exception as exc:  # noqa: BLE001
                print(f"FAILED: Article '{handle}' error: {exc}")
                failed.append(handle)

    print("\nSummary:")
    print(f"Created: {len(created)}")
    print(f"Skipped: {len(skipped)}")
    print(f"Failed: {len(failed)}")
    print(f"Created handles: {created}")
    print(f"Skipped handles: {skipped}")
    print(f"Failed handles: {failed}")


if __name__ == "__main__":
    main()
