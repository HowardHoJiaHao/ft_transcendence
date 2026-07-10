import hashlib
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple

import psycopg2
from pgvector.psycopg2 import register_vector

from embeddings import get_embeddings


logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent
FAQ_DIR = BASE_DIR / "faq_docs"
RETRIEVAL_VERSION = "v2-hybrid"

DOCUMENT_METADATA: Dict[str, Dict[str, str]] = {
    "how_to_buy.md": {
        "source_id": "how-to-buy",
        "title": "How to Buy Badminton Gear",
        "category": "platform_how_to",
        "audience": "buyer",
        "last_reviewed": "2026-07-10",
    },
    "badminton_guide.md": {
        "source_id": "badminton-guide",
        "title": "Badminton Racket Specifications Guide",
        "category": "racket_specification",
        "audience": "buyer",
        "last_reviewed": "2026-07-10",
    },
    "account_and_safety.md": {
        "source_id": "account-and-safety",
        "title": "Account Settings, Security and Platform Safety",
        "category": "account_security",
        "audience": "all",
        "last_reviewed": "2026-07-10",
    },
    "how_to_sell.md": {
        "source_id": "how-to-sell",
        "title": "How to Create a Listing",
        "category": "platform_how_to",
        "audience": "seller",
        "last_reviewed": "2026-07-10",
    },
    "dealing_methods.md": {
        "source_id": "dealing-methods",
        "title": "Dealing Methods and Safe Transactions",
        "category": "transaction_safety",
        "audience": "all",
        "last_reviewed": "2026-07-10",
    },
}

ALLOWED_CATEGORIES = {
    metadata["category"] for metadata in DOCUMENT_METADATA.values()
} | {"buyer_guidance", "platform_policy"}


def get_db_connection():
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "db"),
        port=os.getenv("DB_PORT", "5432"),
        user=os.getenv("DB_USER", "transcendence"),
        password=os.getenv("DB_PASSWORD", "transcendence_pass"),
        dbname=os.getenv("DB_NAME", "transcendence"),
        connect_timeout=int(os.getenv("RAG_DB_CONNECT_TIMEOUT", "5")),
    )


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "section"


def _content_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _split_large_section(text: str, max_chars: int = 3000) -> List[str]:
    paragraphs = [part.strip() for part in text.split("\n\n") if part.strip()]
    if not paragraphs:
        return []

    chunks: List[str] = []
    current: List[str] = []
    current_length = 0
    for paragraph in paragraphs:
        additional = len(paragraph) + (2 if current else 0)
        if current and current_length + additional > max_chars:
            chunks.append("\n\n".join(current))
            current = []
            current_length = 0
        current.append(paragraph)
        current_length += len(paragraph) + (2 if len(current) > 1 else 0)
    if current:
        chunks.append("\n\n".join(current))
    return chunks


def _parse_markdown_sections(content: str) -> Tuple[str, List[Tuple[str, str]]]:
    document_title = "Untitled"
    current_title = "Overview"
    current_lines: List[str] = []
    sections: List[Tuple[str, str]] = []

    def flush() -> None:
        nonlocal current_lines
        body = "\n".join(current_lines).strip()
        if body:
            sections.append((current_title, body))
        current_lines = []

    for raw_line in content.splitlines():
        line = raw_line.rstrip()
        top_heading = re.match(r"^#\s+(.+)$", line)
        section_heading = re.match(r"^##\s+(.+)$", line)
        if top_heading:
            document_title = top_heading.group(1).strip()
            continue
        if section_heading:
            flush()
            current_title = section_heading.group(1).strip()
            continue
        current_lines.append(line)
    flush()
    return document_title, sections


def build_knowledge_chunks(faq_dir: Path = FAQ_DIR) -> List[Dict[str, Any]]:
    chunks: List[Dict[str, Any]] = []
    if not faq_dir.exists():
        return chunks

    for path in sorted(faq_dir.glob("*.md")):
        metadata = DOCUMENT_METADATA.get(
            path.name,
            {
                "source_id": _slug(path.stem),
                "title": path.stem.replace("_", " ").title(),
                "category": "buyer_guidance",
                "audience": "all",
                "last_reviewed": "unknown",
            },
        )
        content = path.read_text(encoding="utf-8")
        parsed_title, sections = _parse_markdown_sections(content)
        document_title = metadata.get("title") or parsed_title
        for section_title, section_body in sections:
            for index, chunk_text in enumerate(_split_large_section(section_body), start=1):
                source_id = metadata["source_id"]
                chunk_id = f"{source_id}:{_slug(section_title)}:{index}"
                chunks.append(
                    {
                        "chunk_id": chunk_id,
                        "source_id": source_id,
                        "source_file": path.name,
                        "document_title": document_title,
                        "section_title": section_title,
                        "category": metadata["category"],
                        "audience": metadata["audience"],
                        "last_reviewed": metadata["last_reviewed"],
                        "content": chunk_text,
                        "content_hash": _content_hash(
                            f"{document_title}\n{section_title}\n{chunk_text}"
                        ),
                    }
                )
    return chunks


def _ensure_schema(conn) -> None:
    register_vector(conn)
    with conn.cursor() as cursor:
        cursor.execute("CREATE EXTENSION IF NOT EXISTS vector;")
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS knowledge_chunks (
                id BIGSERIAL PRIMARY KEY,
                chunk_id VARCHAR(255) NOT NULL,
                source_id VARCHAR(255) NOT NULL,
                source_file VARCHAR(255) NOT NULL,
                document_title TEXT NOT NULL,
                section_title TEXT NOT NULL,
                category VARCHAR(100) NOT NULL,
                audience VARCHAR(50) NOT NULL DEFAULT 'all',
                last_reviewed VARCHAR(32),
                chunk_text TEXT NOT NULL,
                content_hash CHAR(64) NOT NULL,
                embedding_model VARCHAR(255) NOT NULL,
                embedding_dimension INT NOT NULL,
                ingestion_version VARCHAR(100) NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT FALSE,
                search_vector TSVECTOR GENERATED ALWAYS AS (
                    to_tsvector(
                        'english',
                        COALESCE(document_title, '') || ' ' ||
                        COALESCE(section_title, '') || ' ' ||
                        COALESCE(chunk_text, '')
                    )
                ) STORED,
                embedding VECTOR NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (ingestion_version, chunk_id)
            );
            """
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_active "
            "ON knowledge_chunks (is_active, category);"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_search "
            "ON knowledge_chunks USING GIN (search_vector);"
        )
    conn.commit()


def _embedding_model_id(embedding_client: Any) -> str:
    return str(
        getattr(embedding_client, "model", None)
        or os.getenv("OPENROUTER_EMBEDDING_MODEL", "unknown")
    )


def _as_list(vector: Any) -> List[float]:
    if hasattr(vector, "tolist"):
        vector = vector.tolist()
    return [float(value) for value in vector]


def _embed_documents_batched(embedding_client: Any, texts: Sequence[str]) -> List[Any]:
    """Keep batches small for embedding providers with per-request limits."""

    # The configured OpenRouter NVIDIA embedding route currently accepts two
    # text inputs reliably but may return an empty data array for larger
    # batches. Keep the default conservative and configurable.
    batch_size = max(1, min(int(os.getenv("RAG_EMBEDDING_BATCH_SIZE", "2")), 16))
    vectors: List[Any] = []
    for start in range(0, len(texts), batch_size):
        vectors.extend(embedding_client.embed_documents(list(texts[start : start + batch_size])))
    return vectors


def ingest_knowledge(
    *,
    embedding_factory: Callable[[], Any] = get_embeddings,
    connection_factory: Callable[[], Any] = get_db_connection,
) -> Dict[str, Any]:
    """Safely build a new knowledge version without deleting the active one."""

    chunks = build_knowledge_chunks()
    if not chunks:
        return {"ok": False, "error": "No knowledge documents were found"}

    embedding_client = embedding_factory()
    model_id = _embedding_model_id(embedding_client)
    conn = connection_factory()
    try:
        _ensure_schema(conn)
        reusable: Dict[str, List[float]] = {}
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT DISTINCT ON (content_hash) content_hash, embedding
                FROM knowledge_chunks
                WHERE embedding_model = %s
                ORDER BY content_hash, created_at DESC
                """,
                (model_id,),
            )
            reusable = {
                content_hash: _as_list(vector)
                for content_hash, vector in cursor.fetchall()
            }

        missing_chunks = [
            chunk for chunk in chunks if chunk["content_hash"] not in reusable
        ]
        if missing_chunks:
            texts = [
                f"{chunk['document_title']}\n{chunk['section_title']}\n{chunk['content']}"
                for chunk in missing_chunks
            ]
            generated = _embed_documents_batched(embedding_client, texts)
            if len(generated) != len(missing_chunks):
                raise ValueError("Embedding provider returned an unexpected batch size")
            for chunk, vector in zip(missing_chunks, generated):
                reusable[chunk["content_hash"]] = _as_list(vector)

        dimensions = {len(reusable[chunk["content_hash"]]) for chunk in chunks}
        if len(dimensions) != 1 or 0 in dimensions:
            raise ValueError("Knowledge embeddings have inconsistent dimensions")
        embedding_dimension = dimensions.pop()
        version_seed = "".join(chunk["content_hash"] for chunk in chunks)
        version_hash = hashlib.sha256(version_seed.encode("utf-8")).hexdigest()[:12]
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        ingestion_version = f"{timestamp}-{version_hash}"

        with conn:
            with conn.cursor() as cursor:
                for chunk in chunks:
                    cursor.execute(
                        """
                        INSERT INTO knowledge_chunks (
                            chunk_id, source_id, source_file, document_title,
                            section_title, category, audience, last_reviewed,
                            chunk_text, content_hash, embedding_model,
                            embedding_dimension, ingestion_version, is_active,
                            embedding
                        ) VALUES (
                            %s, %s, %s, %s, %s, %s, %s, %s,
                            %s, %s, %s, %s, %s, FALSE, %s
                        )
                        ON CONFLICT (ingestion_version, chunk_id) DO UPDATE SET
                            chunk_text = EXCLUDED.chunk_text,
                            content_hash = EXCLUDED.content_hash,
                            embedding = EXCLUDED.embedding,
                            updated_at = CURRENT_TIMESTAMP
                        """,
                        (
                            chunk["chunk_id"],
                            chunk["source_id"],
                            chunk["source_file"],
                            chunk["document_title"],
                            chunk["section_title"],
                            chunk["category"],
                            chunk["audience"],
                            chunk["last_reviewed"],
                            chunk["content"],
                            chunk["content_hash"],
                            model_id,
                            embedding_dimension,
                            ingestion_version,
                            reusable[chunk["content_hash"]],
                        ),
                    )
                cursor.execute(
                    "UPDATE knowledge_chunks SET is_active = FALSE WHERE is_active = TRUE"
                )
                cursor.execute(
                    "UPDATE knowledge_chunks SET is_active = TRUE "
                    "WHERE ingestion_version = %s",
                    (ingestion_version,),
                )

        result = {
            "ok": True,
            "ingestion_version": ingestion_version,
            "documents": len({chunk["source_id"] for chunk in chunks}),
            "chunks": len(chunks),
            "embedding_model": model_id,
            "embedding_dimension": embedding_dimension,
            "reused_embeddings": len(chunks) - len(missing_chunks),
        }
        logger.info("Knowledge ingestion completed: %s", result)
        return result
    except Exception:
        conn.rollback()
        logger.exception("Knowledge ingestion failed; previous active version preserved")
        raise
    finally:
        conn.close()


def ingest_faqs() -> Dict[str, Any]:
    """Backward-compatible command name used by existing deployment scripts."""

    return ingest_knowledge()


def _query_terms(query: str) -> List[str]:
    return [
        token
        for token in re.findall(r"[a-z0-9]+", query.lower())
        if len(token) > 1
    ]


def _local_score(query: str, chunk: Dict[str, Any]) -> float:
    terms = _query_terms(query)
    if not terms:
        return 0.0
    title = f"{chunk['document_title']} {chunk['section_title']}".lower()
    content = chunk["content"].lower()
    matched = sum(1 for term in terms if term in content)
    title_matches = sum(1 for term in terms if term in title)
    phrase_bonus = 1.0 if query.lower().strip() in content else 0.0
    return round((matched + (1.5 * title_matches) + phrase_bonus) / len(terms), 4)


def _public_chunk(chunk: Dict[str, Any], relevance_score: float) -> Dict[str, Any]:
    return {
        "chunk_id": chunk["chunk_id"],
        "source_id": chunk["source_id"],
        "source_file": chunk["source_file"],
        "title": chunk.get("section_title") or chunk.get("document_title"),
        "document_title": chunk.get("document_title"),
        "category": chunk["category"],
        "content": chunk["content"],
        "relevance_score": round(float(relevance_score), 4),
    }


def _retrieve_local_knowledge(
    query: str,
    categories: Optional[Sequence[str]],
    top_k: int,
) -> Dict[str, Any]:
    allowed = set(categories or [])
    candidates = [
        chunk
        for chunk in build_knowledge_chunks()
        if not allowed or chunk["category"] in allowed
    ]
    scored = [(_local_score(query, chunk), chunk) for chunk in candidates]
    scored.sort(key=lambda item: item[0], reverse=True)
    chunks = [
        _public_chunk(chunk, score)
        for score, chunk in scored[:top_k]
        if score > 0
    ]
    return {
        "chunks": chunks,
        "meta": {
            "source": "local_files",
            "retrieval_version": RETRIEVAL_VERSION,
            "fallback_used": True,
        },
    }


def retrieve_knowledge_chunks(
    query: str,
    categories: Optional[Sequence[str]] = None,
    top_k: int = 5,
    *,
    embedding_factory: Callable[[], Any] = get_embeddings,
    connection_factory: Callable[[], Any] = get_db_connection,
) -> Dict[str, Any]:
    clean_query = query.strip()
    if not clean_query:
        raise ValueError("Knowledge query cannot be empty")
    safe_top_k = max(1, min(int(top_k), 8))
    clean_categories = [
        category for category in (categories or []) if category in ALLOWED_CATEGORIES
    ]

    try:
        embedding_client = embedding_factory()
        query_vector = _as_list(embedding_client.embed_query(clean_query))
        if not query_vector:
            raise ValueError("Embedding provider returned an empty query vector")

        conn = connection_factory()
        try:
            _ensure_schema(conn)
            register_vector(conn)
            where = "WHERE is_active = TRUE"
            params: List[Any] = [query_vector, clean_query]
            if clean_categories:
                where += " AND category = ANY(%s)"
                params.append(clean_categories)
            params.append(safe_top_k)
            with conn.cursor() as cursor:
                cursor.execute(
                    f"""
                    SELECT
                        chunk_id, source_id, source_file, document_title,
                        section_title, category, chunk_text,
                        GREATEST(0, 1 - (embedding <=> %s::vector)) AS semantic_score,
                        ts_rank_cd(search_vector, plainto_tsquery('english', %s))
                            AS lexical_score,
                        embedding_model, ingestion_version
                    FROM knowledge_chunks
                    {where}
                    ORDER BY (
                        0.75 * GREATEST(0, 1 - (embedding <=> %s::vector)) +
                        0.25 * LEAST(
                            1,
                            ts_rank_cd(search_vector, plainto_tsquery('english', %s))
                        )
                    ) DESC
                    LIMIT %s
                    """,
                    [query_vector, clean_query]
                    + ([clean_categories] if clean_categories else [])
                    + [query_vector, clean_query, safe_top_k],
                )
                rows = cursor.fetchall()
        finally:
            conn.close()

        min_relevance = float(os.getenv("RAG_MIN_RELEVANCE", "0.15"))
        public_chunks = []
        embedding_model = _embedding_model_id(embedding_client)
        ingestion_version = None
        for row in rows:
            (
                chunk_id,
                source_id,
                source_file,
                document_title,
                section_title,
                category,
                content,
                semantic_score,
                lexical_score,
                row_embedding_model,
                row_ingestion_version,
            ) = row
            combined = (0.75 * float(semantic_score or 0)) + (
                0.25 * min(1.0, float(lexical_score or 0))
            )
            if combined < min_relevance:
                continue
            public_chunks.append(
                _public_chunk(
                    {
                        "chunk_id": chunk_id,
                        "source_id": source_id,
                        "source_file": source_file,
                        "document_title": document_title,
                        "section_title": section_title,
                        "category": category,
                        "content": content,
                    },
                    combined,
                )
            )
            embedding_model = row_embedding_model
            ingestion_version = row_ingestion_version

        return {
            "chunks": public_chunks,
            "meta": {
                "source": "pgvector_hybrid",
                "embedding_model": embedding_model,
                "ingestion_version": ingestion_version,
                "retrieval_version": RETRIEVAL_VERSION,
                "fallback_used": False,
            },
        }
    except Exception as exc:
        logger.warning(
            "Vector knowledge retrieval unavailable; using local fallback: %s",
            type(exc).__name__,
        )
        return _retrieve_local_knowledge(clean_query, clean_categories, safe_top_k)


def retrieve_faq_context(query: str) -> str:
    """Compatibility adapter for code outside the new agentic path."""

    result = retrieve_knowledge_chunks(query)
    return "\n\n".join(
        f"[Source: {chunk['source_file']} — {chunk['title']}]\n{chunk['content']}"
        for chunk in result["chunks"]
    )


if __name__ == "__main__":
    print(ingest_knowledge())
