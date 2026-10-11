"""Shared connection helpers. Secrets come from apps/api/.env and are never printed."""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")


def env(name):
    v = os.environ.get(name)
    if not v:
        raise SystemExit(f"missing env var {name} in apps/api/.env")
    return v


def qdrant():
    from qdrant_client import QdrantClient
    return QdrantClient(url=env("QDRANT_URL"), api_key=env("QDRANT_API_KEY"), timeout=60)


def neo4j_driver():
    """Verified TLS using the certifi CA bundle (this machine does not trust SSL.com's root)."""
    import certifi
    from neo4j import GraphDatabase, TrustCustomCAs
    uri = env("NEO4J_URI")
    host = uri.split("://", 1)[1]  # neo4j+s://host -> neo4j://host with explicit encryption
    return GraphDatabase.driver(f"neo4j://{host}", auth=(env("NEO4J_USERNAME"), env("NEO4J_PASSWORD")),
                                encrypted=True, trusted_certificates=TrustCustomCAs(certifi.where()))
