# Personal Study Focus

This is a personal learning guide for understanding the parts of the project that I worked on, while still understanding how the rest of the team project connects together.

`focus.md` is intentionally ignored by Git because it is a personal study note, not application documentation.

## Main goal

I do not need to memorize every function in the project. For each feature, I should understand:

1. Which frontend page or component starts the feature.
2. Which API request is sent.
3. Which backend route receives it.
4. Whether authentication is required.
5. Which database tables or files are affected.
6. What response comes back to the frontend.

The most useful diagram for each feature is:

```text
Frontend
  -> API request
  -> backend route
  -> authentication/validation
  -> database or file storage
  -> JSON response
  -> frontend state update
```

## Study in detail

These are the features I covered. I should understand their complete data flow, important validation, security rules, and failure cases.

### 1. Sell listings and image uploading

Priority: **deep understanding**

Start here because this feature connects frontend, backend, authentication, PostgreSQL, Docker bind mounts, and static files.

Read:

- `frontend/src/app/(user)/sell/page.tsx`
- `backend/products.go`
- `backend/myMiddleware/auth.go`
- `backend/db.go`
- `db/init.sql`
- `nginx/conf/default.conf`
- `docker-compose.yml`

Understand in detail:

- How the sell form stores its values in React state.
- How the form creates or updates a listing.
- Which fields are sent in the request body.
- How the JWT identifies the seller.
- How the backend validates the request.
- How a row is inserted into or updated in `listings`.
- How an image is received and stored.
- The difference between the image file path and the database image record/path.
- How `./static/listings` is mounted into `/app/static/listings`.
- How Nginx and the backend serve the image back to the browser.
- What happens when the file type, listing ID, user, or request body is invalid.

Target flow:

```text
/sell
  -> POST /api/v1/products
  -> JWTAuth middleware
  -> createProduct()
  -> INSERT into listings
  -> upload listing images
  -> static/listings on the host
  -> image URL returned to frontend
```

### 2. User profile

Priority: **deep understanding**

Read:

- `frontend/src/app/(user)/profile/page.tsx`
- `frontend/src/app/(user)/profile/change-email/page.tsx`
- `frontend/src/app/(user)/profile/change-phoneNo/page.tsx`
- `frontend/src/app/(user)/profile/change-password/page.tsx`
- `frontend/src/context/AuthContext.tsx`
- `backend/modules/user/profile/handler.go`
- `backend/modules/user/profile/service.go`
- `backend/modules/user/auth/handler.go`
- `backend/modules/user/repository.go`
- `db/init.sql`

Understand in detail:

- How the logged-in user is represented in `AuthContext`.
- Where the JWT is stored and how it is sent.
- How `/api/v1/me` and `/api/v1/users/update` work.
- How the backend gets the trusted user ID from the middleware.
- Which profile fields are read and updated.
- How avatar data or avatar URLs are handled.
- Why password changes require the current password and OTP.
- Why frontend state and `localStorage` must be updated after a profile change.

### 3. Admin login and user management

Priority: **deep understanding of authorization; medium detail for UI**

Read:

- `frontend/src/app/admin/login/page.tsx`
- `frontend/src/app/admin/users/page.tsx`
- `backend/admin.go`
- `backend/myMiddleware/auth.go`
- `backend/modules/user/auth/service.go`
- `db/init.sql`

Understand in detail:

- How an admin token differs from a normal member token.
- How `AdminAuth()` checks the JWT role.
- How user suspension and restoration affect `account_status`.
- Why the backend must enforce admin access even if the frontend hides pages.
- How the admin token is stored and sent by the frontend.

Understand at medium detail:

- The React table, filtering, and summary-count implementation.
- Styling and small UI helper functions.

### 4. AI chatbox

Priority: **deep understanding of the request flow; medium detail for framework internals**

Read:

- `frontend/src/components/AIFloatingChat/AIFloatingChat.tsx`
- `backend/ai_chat.go`
- `ai_service/main.py`
- `ai_service/agent.py`
- `ai_service/tools.py`

Understand in detail:

- How the frontend sends the message, history, token, and recommendation profile.
- Why the Go backend is the authorization boundary.
- How the Go backend forwards the request to `ai:8000`.
- How the AI response is streamed using Server-Sent Events.
- How the frontend reads SSE chunks and updates the assistant message.
- How guest requests differ from authenticated requests.
- Which AI tools are read-only and which data they can access.
- What happens on timeout, invalid authentication, or AI failure.

Understand at a surface level initially:

- The internal LangGraph node implementation.
- Every middleware implementation detail.
- The provider SDK internals.

First understand the flow:

```text
AI chat component
  -> Go /api/v1/ai/chat
  -> optional JWT validation
  -> Python /chat
  -> agent and tools
  -> SSE response
  -> frontend chat bubble
```

### 5. Racket recommendation system

Priority: **understand the input/output contract deeply; understand the model internals at a surface level**

Read:

- `frontend/src/components/AIFloatingChat/AIFloatingChat.tsx`
- `ai_service/main.py`
- `ai_service/recommender.py`
- `ai_service/tools.py`
- `ai_service/agent.py`

Understand in detail:

- The five assessment inputs:
  - age group
  - gender
  - experience level
  - play style
  - budget range
- How values are normalized and validated.
- The three prediction outputs:
  - weight category
  - flexibility category
  - balance category
- How the prediction is passed to the agent.
- How the predicted specifications are used to search current listings.
- The difference between an ML prediction and a guaranteed fact.
- What happens if the model file is missing or the profile is invalid.

Understand at a surface level initially:

- How the model was trained.
- The internals of `joblib` and the estimator.
- The mathematical details of confidence scores.

### 6. RAG

Priority: **deep understanding of the pipeline; surface-level understanding of embedding-model mathematics**

Read:

- `ai_service/rag.py`
- `ai_service/embeddings.py`
- `ai_service/tools.py`
- `ai_service/main.py`
- `ai_service/faq_docs/`
- `db/init.sql`
- `docker-compose.yml`

Understand in detail:

- FAQ Markdown files are the source knowledge.
- Documents are split into chunks.
- OpenRouter creates an embedding for each chunk.
- Text and embeddings are stored in `knowledge_chunks`.
- Ingestion normally starts when the AI service starts.
- Existing embeddings can be reused when content has not changed.
- A new ingestion version is activated only after it is successfully built.
- A user query is embedded at retrieval time.
- PostgreSQL compares the query vector with stored vectors using pgvector.
- Retrieval combines semantic similarity with keyword search.
- Retrieved text is provided to the AI as evidence.
- If vector retrieval fails, the local FAQ fallback may be used.

Understand at a surface level initially:

- The exact mathematics behind embeddings.
- The internal neural-network architecture of the embedding model.
- Every pgvector index implementation detail.

Target flow:

```text
FAQ Markdown
  -> chunks
  -> OpenRouter embedding API
  -> knowledge_chunks.embedding

User question
  -> query embedding
  -> PostgreSQL similarity search
  -> relevant text chunks
  -> AI answer
```

## Understand at surface level

These areas are important for integration, but I do not need to study every function because they were mainly built by other team members.

### Frontend shared architecture

Know the purpose of:

- `frontend/src/app/layout.tsx`
- `frontend/src/context/AuthContext.tsx`
- `frontend/src/context/CartContext.tsx`
- `frontend/src/context/WebSocketContext.tsx`
- `frontend/src/hooks/`

I should know how shared state reaches pages and how API calls are made, but I do not need to memorize every component or CSS module.

### Authentication internals

Know the full login and protected-request flow:

```text
login
  -> backend verifies password
  -> backend creates JWT
  -> frontend stores token
  -> frontend sends Bearer token
  -> middleware validates token
```

Study the security rules carefully, but only understand email/OTP implementation details as needed by a feature.

### Product browsing and product details

Know:

- Which frontend pages display listings.
- Which product API endpoints exist.
- That the backend queries `listings`.
- How filters and pagination are represented in query parameters.

Do not initially study every product-card styling detail.

### Orders and cart

Know:

- The cart is frontend state/local storage.
- Checkout calls the protected orders endpoint.
- The backend validates ownership, status, and stock.
- Order creation and stock changes use a database transaction.

Study the transaction logic more deeply only when changing order behavior.

### Friends and WebSocket chat

Know:

- HTTP is used for loading conversations and message history.
- WebSocket is used for real-time messages and online status.
- The backend chat hub tracks connected users.
- Messages are stored in PostgreSQL.

Initially understand the message flow, not every goroutine and heartbeat detail.

### Docker and Nginx

Know:

- Compose starts the services.
- Nginx sends `/` to the frontend and `/api/` to the backend.
- Service names such as `db`, `backend`, and `ai` work on the Docker network.
- Bind mounts preserve uploaded files.
- The PostgreSQL named volume preserves database data.

You do not need to memorize every Dockerfile instruction yet.

## What to learn first

Follow this order:

1. `/sell` listing creation without images.
2. `/sell` image upload and static file serving.
3. `/profile` data loading and updating.
4. Admin authentication and account-status changes.
5. AI chat request and streaming response.
6. Recommendation assessment and prediction contract.
7. RAG ingestion and retrieval.
8. Product browsing and product details.
9. Orders and cart.
10. Friends and WebSocket chat.

## A study note template

For each feature, write down:

```text
Feature:

Frontend entry point:
API endpoint:
HTTP method:
Authentication required:
Backend handler:
Database tables:
Files/storage involved:
Response shape:
Main validation rules:
Failure cases:
```

## Definition of understanding

I understand a feature when I can explain it without reading the code:

```text
When the user does X, the frontend sends Y to endpoint Z.
The backend checks A, changes B, and returns C.
The frontend then updates D.
```

I do not need to know who wrote every function or understand every implementation detail. I need to understand ownership, boundaries, data flow, and the parts I may need to safely change.

## Evaluation-focused study approach

I am preparing for a 42 evaluation, so I do not need to memorize every line of code. For each feature, I should confidently explain:

- What the feature does.
- Why it is designed this way.
- How data flows through the system.
- What happens when something fails.

### Sell feature: minimum explanation to prepare

```text
User fills the sell form
  -> React stores values temporarily
  -> Frontend validates basic input
  -> POST /api/v1/products
  -> Backend validates JWT and listing data
  -> PostgreSQL stores the listing
  -> POST /api/v1/products/:id/images
  -> Backend stores images in static/listings
```

I should be able to explain:

- Why React state is used.
- Why the user must be logged in.
- Why the listing is created before images are uploaded.
- Why images use `FormData`.
- Where the images are stored.
- How the backend knows which user owns the listing.
- What happens if validation, listing creation, or image upload fails.

This level of understanding is more important than explaining every JSX element in the 700-line page.

### Study depth by ownership

#### Study deeply

Study my own features by their complete flow:

- `/sell` and image uploading.
- `/profile`.
- Admin user management.
- AI chat.
- Recommendation system.
- RAG.

Focus on the feature flow, decisions, security, data storage, and failure cases rather than memorizing every line.

#### Study at medium level

Understand the shared code that my features depend on:

- `AuthContext`.
- JWT middleware.
- `backend/db.go`.
- `backend/main.go`.
- Product routes.
- Nginx routing.
- Docker Compose networking.

I should know what these parts do and how my feature uses them.

#### Study at surface level

I do not need to deeply study:

- CSS modules.
- Every JSX layout element.
- Every shared component.
- Features built entirely by teammates.
- Internal LangChain implementation details.
- Every helper function.

For the large JSX block, identify only:

- Which input updates which state.
- Which button calls which function.
- Which section is shown for each `step` value.

### One-minute feature explanation template

For each feature, prepare an answer using this template:

```text
My feature is responsible for ______.

The frontend starts in ______.

It sends ______ to the backend.

The backend checks ______.

The data is stored in ______.

Images or files are stored in ______.

The important security rule is ______.

If something fails, ______ happens.
```

Example for the sell feature:

> The sell feature allows an authenticated user to create or edit a marketplace listing. The React page temporarily stores the form values in state. When submitted, it sends JSON to the Go backend. The JWT middleware identifies the seller, and the backend validates the listing before inserting it into PostgreSQL. Images are uploaded separately using `FormData`, stored under `static/listings`, and the image URL is saved with the listing. If validation or uploading fails, the frontend shows an error message.

### Best order for studying `/sell`

1. Understand what the page is for.
2. Identify what data it stores in React state.
3. Understand what happens when the user submits.
4. Identify which API endpoints it calls.
5. Follow what the backend does.
6. Identify which database tables and files are affected.

The goal is to explain the complete feature flow, not to understand every `<div>`.
