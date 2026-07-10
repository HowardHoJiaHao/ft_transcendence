import unittest

import rag


class BrokenEmbeddings:
    model = "broken"

    def embed_query(self, _query):
        raise RuntimeError("provider unavailable")


class RecordingEmbeddings:
    def __init__(self):
        self.batch_sizes = []

    def embed_documents(self, texts):
        self.batch_sizes.append(len(texts))
        return [[float(index)] for index, _ in enumerate(texts)]


class RagTests(unittest.TestCase):
    def test_semantic_chunks_keep_source_and_section_metadata(self):
        chunks = rag.build_knowledge_chunks()
        self.assertGreater(len(chunks), 10)
        self.assertTrue(all(chunk["chunk_id"] for chunk in chunks))
        self.assertTrue(all(chunk["section_title"] for chunk in chunks))
        self.assertTrue(all(chunk["content_hash"] for chunk in chunks))

    def test_local_retrieval_returns_structured_relevant_evidence(self):
        result = rag._retrieve_local_knowledge(
            "What does a flexible racket shaft mean?",
            ["racket_specification"],
            3,
        )
        self.assertEqual(result["meta"]["source"], "local_files")
        self.assertTrue(result["chunks"])
        self.assertEqual(result["chunks"][0]["source_id"], "badminton-guide")
        self.assertIn("content", result["chunks"][0])

    def test_vector_failure_uses_same_structured_fallback_contract(self):
        result = rag.retrieve_knowledge_chunks(
            "How do I contact a seller?",
            embedding_factory=lambda: BrokenEmbeddings(),
            connection_factory=lambda: None,
        )
        self.assertTrue(result["meta"]["fallback_used"])
        self.assertIsInstance(result["chunks"], list)
        self.assertTrue(result["chunks"])

    def test_embedding_batches_are_bounded(self):
        client = RecordingEmbeddings()
        vectors = rag._embed_documents_batched(client, [str(index) for index in range(10)])
        self.assertEqual(len(vectors), 10)
        self.assertEqual(client.batch_sizes, [2, 2, 2, 2, 2])

    def test_audited_documents_do_not_promise_unsupported_safety(self):
        buy = (rag.FAQ_DIR / "how_to_buy.md").read_text(encoding="utf-8")
        safety = (rag.FAQ_DIR / "account_and_safety.md").read_text(encoding="utf-8")
        self.assertNotIn("absolute safety", buy.lower())
        self.assertNotIn("click the **report** button", safety.lower())


if __name__ == "__main__":
    unittest.main()
