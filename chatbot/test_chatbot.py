import unittest
from app import tokenize, calculate_cosine_similarity, get_relevant_context, KNOWLEDGE_PARAGRAPHS, app

class TestChatbot(unittest.TestCase):
    def test_tokenization(self):
        tokens = tokenize("Halo, apa kabar? Batur Hot Spring!")
        self.assertEqual(tokens, ["halo", "apa", "kabar", "batur", "hot", "spring"])

    def test_cosine_similarity(self):
        # Perfect similarity
        sim1 = calculate_cosine_similarity("tiket masuk", "tiket masuk")
        self.assertAlmostEqual(sim1, 1.0)
        
        # Zero similarity
        sim2 = calculate_cosine_similarity("bca transfer", "kucing makan ikan")
        self.assertEqual(sim2, 0.0)
        
        # Partial similarity
        sim3 = calculate_cosine_similarity("harga tiket dewasa", "tiket masuk kategori dewasa")
        self.assertTrue(0.0 < sim3 < 1.0)

    def test_rag_retrieval(self):
        query = "berapa harga tiket dewasa?"
        context = get_relevant_context(query, KNOWLEDGE_PARAGRAPHS, top_n=2)
        # Should retrieve the paragraph containing ticket prices
        self.assertIn("150.000", context)
        self.assertIn("Tiket Masuk Dewasa", context)

        query_hours = "jam berapa pemandian buka?"
        context_hours = get_relevant_context(query_hours, KNOWLEDGE_PARAGRAPHS, top_n=2)
        # Should retrieve operational hours
        self.assertIn("07:00", context_hours)
        self.assertIn("19:00", context_hours)

    def test_flask_webhook_endpoint(self):
        client = app.test_client()
        # Test basic POST without message event (should respond with 200 OK)
        response = client.post('/webhook', json={})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data.decode(), "OK")

if __name__ == '__main__':
    unittest.main()
