the rag is using chunking + vector similarity

if i want better quality retrieval, i can do this 

top k + threshold

hybrid retrieval such as combine vector search with keyword/bm25

query expansion

metadata boosting


main.py: the routing and fallback logic is already fairly heuristic-heavy. It will get harder to maintain as you add features. I would gradually refactor toward a single “router” layer and move formatting into isolated templates or formatters.
tools.py: tool outputs are hard-coded strings. This is okay for quick UI, but it makes downstream formatting fragile. Returning structured JSON and letting a formatter handle display is more flexible and easier to test.