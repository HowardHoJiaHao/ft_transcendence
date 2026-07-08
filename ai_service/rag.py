import os
import psycopg2
from pgvector.psycopg2 import register_vector
from embeddings import get_embeddings

def get_db_connection():
    conn = psycopg2.connect(
        host=os.getenv("DB_HOST", "db"),
        port=os.getenv("DB_PORT", "5432"),
        user=os.getenv("DB_USER", "transcendence"),
        password=os.getenv("DB_PASSWORD", "transcendence_pass"),
        dbname=os.getenv("DB_NAME", "transcendence")
    )
    return conn

def ensure_vector_extension(conn):
    with conn.cursor() as cur:
        cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
    conn.commit()
    register_vector(conn)

def _retrieve_local_faq_context(query: str) -> str:
    faq_dir = "faq_docs"
    if not os.path.exists(faq_dir):
        return ""

    query_terms = [term for term in query.lower().split() if len(term) > 2]
    scored_chunks = []

    for filename in os.listdir(faq_dir):
        if not filename.endswith(".md"):
            continue
        filepath = os.path.join(faq_dir, filename)
        with open(filepath, "r", encoding="utf-8") as f:
            sections = [section.strip() for section in f.read().split("\n\n") if section.strip()]

        for section in sections:
            lowered = section.lower()
            score = sum(1 for term in query_terms if term in lowered)
            if score:
                scored_chunks.append((score, filename, section))

    scored_chunks.sort(key=lambda item: item[0], reverse=True)
    return "\n\n".join(
        f"[Source: {filename}]\n{section}"
        for _, filename, section in scored_chunks[:4]
    )

def retrieve_faq_context(query: str) -> str:
    try:
        embeddings = get_embeddings()
        query_vector = embeddings.embed_query(query)
        if not query_vector:
            raise ValueError("Embedding provider returned an empty query vector")
        
        conn = get_db_connection()
        register_vector(conn)
        cur = conn.cursor()
        
        # Calculate cosine similarity using pgvector distance operator <=>
        cur.execute(
            """
            SELECT source_file, chunk_text, (embedding <=> %s) AS distance 
            FROM faq_embeddings 
            ORDER BY distance ASC 
            LIMIT 4;
            """,
            (query_vector,)
        )
        results = cur.fetchall()
        cur.close()
        conn.close()
        
        if not results:
            return ""
            
        context_chunks = []
        for row in results:
            source, text, dist = row
            # Cosine distance of 0.6 is a standard similarity threshold
            if dist < 0.6:
                context_chunks.append(f"[Source: {source}]\n{text}")
                
        return "\n\n".join(context_chunks)
    except Exception as e:
        print(f"FAQ vector retrieval unavailable, using local FAQ fallback: {e}")
        return _retrieve_local_faq_context(query)

def ingest_faqs():
    try:
        conn = get_db_connection()
        ensure_vector_extension(conn)
        cur = conn.cursor()
        
        # Ensure extension and table exist
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS faq_embeddings (
                id SERIAL PRIMARY KEY,
                source_file VARCHAR(255),
                chunk_text TEXT NOT NULL,
                embedding vector(1536),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_faq_embeddings_vector ON faq_embeddings USING ivfflat (embedding vector_cosine_ops);"
        )
        conn.commit()
        
        # Clear existing to prevent double-inserting
        cur.execute("DELETE FROM faq_embeddings;")
        conn.commit()
        
        faq_dir = "faq_docs"
        if not os.path.exists(faq_dir):
            print("FAQ directory 'faq_docs' does not exist yet.")
            cur.close()
            conn.close()
            return
            
        embeddings = get_embeddings()
        
        for filename in os.listdir(faq_dir):
            if filename.endswith(".md"):
                filepath = os.path.join(faq_dir, filename)
                with open(filepath, "r", encoding="utf-8") as f:
                    content = f.read()
                
                # Split markdown into paragraphs or headings
                sections = content.split("\n\n")
                chunks = []
                current_chunk = []
                
                for sec in sections:
                    sec = sec.strip()
                    if not sec:
                        continue
                    # Keep headings and paragraphs combined if they are short, or split them
                    if sec.startswith("#"):
                        if current_chunk:
                            chunks.append("\n\n".join(current_chunk))
                            current_chunk = []
                        current_chunk.append(sec)
                    else:
                        current_chunk.append(sec)
                        if len("\n\n".join(current_chunk)) > 200:
                            chunks.append("\n\n".join(current_chunk))
                            current_chunk = []
                
                if current_chunk:
                    chunks.append("\n\n".join(current_chunk))
                
                chunks = [c.strip() for c in chunks if len(c.strip()) > 20]
                
                for chunk in chunks:
                    try:
                        vector = embeddings.embed_query(chunk)
                        if not vector:
                            raise ValueError("Embedding provider returned an empty vector")
                    except Exception as e:
                        print(f"FAQ vector ingestion unavailable, using local FAQ fallback: {e}")
                        cur.close()
                        conn.close()
                        return
                    cur.execute(
                        "INSERT INTO faq_embeddings (source_file, chunk_text, embedding) VALUES (%s, %s, %s);",
                        (filename, chunk, vector)
                    )
                print(f"Ingested {filename} with {len(chunks)} chunks.")
                
        conn.commit()
        cur.close()
        conn.close()
        print("FAQ Ingestion completed successfully.")
    except Exception as e:
        print(f"Error ingesting FAQs: {e}")

if __name__ == "__main__":
    ingest_faqs()
