# PRD: Chatbot ML Racket Recommendation Assessment

## 1. Objective

Build a profile-based racket recommendation system inside RacketBot.

Instead of requiring users to type open-ended recommendation requests, the chatbox will provide a recommendation button. When the user presses it, RacketBot starts a guided assessment flow, collects structured answers through buttons, runs a trained machine learning model, and recommends suitable racket listings from the marketplace.

## 2. Current Project Context

The current implementation already has:

- Frontend chatbot UI in `frontend/src/components/AIFloatingChat/AIFloatingChat.tsx`.
- Frontend-to-backend chat request flow through `/api/v1/ai/chat`.
- Go backend proxy in `backend/ai_chat.go`.
- FastAPI AI service in `ai_service/main.py`.
- AI tools in `ai_service/tools.py`.
- Existing rule-based beginner recommendation logic through `get_beginner_recommendations`.
- Product search available through the backend `/api/v1/products` endpoint.

This feature should build on the existing chatbot and AI service flow rather than replacing it.

## 3. Feature Summary

The feature adds a guided recommendation assessment to the chatbot.

User flow:

1. User opens RacketBot.
2. User clicks `Recommend Me a Racket`.
3. Bot starts the assessment.
4. Bot asks one question at a time.
5. User answers by pressing option buttons.
6. Frontend stores structured assessment values.
7. Frontend submits the completed recommendation profile.
8. AI service runs the trained ML model.
9. Model predicts suitable racket specifications.
10. AI service searches marketplace products matching those specs.
11. Bot returns recommended rackets with short explanations and product links.

## 4. Recommended ML Model

Use a **MultiOutput Random Forest Classifier** from scikit-learn.

Recommended model structure:

```python
Pipeline(
    steps=[
        ("preprocessor", ColumnTransformer(...)),
        ("model", MultiOutputClassifier(RandomForestClassifier(...))),
    ]
)
```

The full preprocessing pipeline should be exported with `joblib`, not only the classifier.

Recommended artifact path:

```text
ai_service/ml_models/racket_recommender.joblib
```

This model should predict racket specifications, not exact product IDs.

Recommended prediction outputs:

```text
weightCategory
flexibilityCategory
balanceCategory
```

Example output:

```json
{
  "weightCategory": "4U",
  "flexibilityCategory": "Medium Flex",
  "balanceCategory": "Even Balance",
  "confidence": 0.82
}
```

## 5. Why MultiOutput Random Forest

The recommendation assessment produces tabular, categorical data. A MultiOutput Random Forest Classifier is a good MVP model because:

- It works well with structured questionnaire data.
- It can predict multiple target fields at once.
- It handles non-linear relationships better than a simple linear model.
- It is easy to train in Google Colab.
- It can be exported and loaded using `joblib`.
- It is practical for small or medium-sized datasets.

## 6. Why Predict Specs Instead Of Product IDs

The model should predict the ideal racket type, not a specific marketplace listing.

Reasons:

- Marketplace listings can change often.
- Product IDs may disappear when sellers delete products.
- Racket specs are stable and reusable.
- The app can search current available products after prediction.
- The ML model does not need retraining every time inventory changes.

Example:

```text
Model predicts:
4U + Medium Flex + Even Balance

System searches:
available rackets matching those specs
```

## 7. Assessment UX

The assessment should use button-based answers instead of free-text answers whenever possible.

This keeps ML input clean and predictable.

Example:

```text
Bot:
What is your play style?

[Attacking] [Defensive] [Balanced] [Not sure]
```

When the user clicks an option:

- Add a visible user message, such as `Attacking`.
- Store the structured value, such as `play_style = "attacking"`.
- Move to the next question.

## 8. Assessment Questions

### Question 1: Age Group

User-facing options:

```text
Under 13
13-17
18-25
26-35
36-45
46+
```

ML field:

```json
"age_group": "18-25"
```

### Question 2: Gender

User-facing options:

```text
Male
Female
Prefer not to say
```

ML field:

```json
"gender": "male"
```

### Question 3: Experience Level

User-facing options:

```text
Less than 6 months
6 months - 1 year
1 - 3 years
3 - 5 years
More than 5 years
```

ML field:

```json
"experience_level": "1-3_years"
```

### Question 4: Play Style

User-facing options:

```text
Attacking
Defensive
Balanced
Not sure
```

ML field:

```json
"play_style": "attacking"
```

### Question 5: Budget Range

User-facing options:

```text
Under RM200
RM200 - RM400
RM400 - RM700
RM700+
```

ML field:

```json
"budget_range": "200-400"
```

## 9. ML Input Contract

The model should receive controlled categorical values.

Example input:

```json
{
  "age_group": "18-25",
  "gender": "male",
  "experience_level": "1-3_years",
  "play_style": "attacking",
  "budget_range": "200-400"
}
```

The model pipeline should handle categorical preprocessing internally.

## 10. Frontend Requirements

Update `frontend/src/components/AIFloatingChat/AIFloatingChat.tsx`.

Add a recommendation action button in the welcome card or chat controls:

```text
Recommend Me a Racket
```

The chatbot should support an assessment mode.

Suggested frontend state:

```ts
type RecommendationProfile = {
  age_group?: string;
  gender?: string;
  experience_level?: string;
  play_style?: string;
  budget_range?: string;
};

type AssessmentStep = {
  key: keyof RecommendationProfile;
  question: string;
  options: Array<{
    label: string;
    value: string;
  }>;
};
```

Frontend behavior:

- Clicking `Recommend Me a Racket` starts assessment mode.
- Bot displays one question at a time.
- User answers using buttons.
- Frontend stores the structured value.
- After the last answer, frontend submits the completed profile.
- The normal chat input can remain available, but assessment answers should use buttons.

## 11. API Contract

For MVP, extend the existing chat payload instead of creating a separate endpoint.

Frontend sends:

```json
{
  "message": "__recommendation_assessment_complete__",
  "history": [],
  "recommendationProfile": {
    "age_group": "18-25",
    "gender": "male",
    "experience_level": "1-3_years",
    "play_style": "attacking",
    "budget_range": "200-400"
  }
}
```

The Go backend should forward `recommendationProfile` to the FastAPI AI service.

FastAPI should detect `recommendationProfile` and skip open-ended text parsing for this MVP flow.

## 12. Backend Requirements

Update `backend/ai_chat.go` to accept and forward the optional `recommendationProfile` object.

No new Go endpoint is required for MVP.

Current flow remains:

```text
Frontend -> Go /api/v1/ai/chat -> FastAPI /chat
```

The Go backend should continue forwarding:

```json
{
  "message": "...",
  "history": [...],
  "userId": 1,
  "recommendationProfile": {}
}
```

## 13. AI Service Requirements

Add a new module:

```text
ai_service/recommender.py
```

Responsibilities:

- Load `racket_recommender.joblib`.
- Validate required profile fields.
- Normalize controlled frontend values if needed.
- Run model prediction.
- Return predicted racket specs.
- Fallback safely if model is missing or fails.

Add a model folder:

```text
ai_service/ml_models/
```

Recommended files:

```text
racket_recommender.joblib
model_metadata.json
```

Suggested `model_metadata.json`:

```json
{
  "model_name": "racket_recommender",
  "model_type": "MultiOutput Random Forest Classifier",
  "version": "1.0.0",
  "features": [
    "age_group",
    "gender",
    "experience_level",
    "play_style",
    "budget_range"
  ],
  "outputs": [
    "weightCategory",
    "flexibilityCategory",
    "balanceCategory"
  ],
  "trained_at": "YYYY-MM-DD"
}
```

Add a new chatbot tool in `ai_service/tools.py`:

```python
get_profile_based_recommendations(...)
```

Responsibilities:

1. Accept structured profile fields.
2. Call the ML recommender.
3. Convert prediction into product filters.
4. Search existing marketplace products.
5. Format recommendations.

## 14. Product Search Logic

After prediction, convert the model output into existing product filters:

```text
weightCategory
flexibilityCategory
balanceCategory
maxPrice or minPrice derived from budget_range
```

Example:

```json
{
  "weightCategory": "4U",
  "flexibilityCategory": "Medium Flex",
  "balanceCategory": "Even Balance",
  "maxPrice": 400
}
```

If exact matches exist, return them.

If no exact matches exist:

- Relax one filter at a time.
- Prefer keeping budget and weight first.
- Explain the tradeoff to the user.

Example:

```text
Your profile points to 4U, Medium Flex, Even Balance.
I could not find an exact match right now, so here are the closest available rackets.
```

## 15. Recommendation Response Format

The bot should return:

- Predicted racket specs.
- Short reason based on the user profile.
- Recommended product cards.
- Product links.

Example:

```text
Based on your assessment, I recommend:
Weight: 4U
Flex: Medium Flex
Balance: Head Heavy

Why this fits:
- 4U gives useful power without being too heavy.
- Medium Flex helps while your technique is still developing.
- Head Heavy supports your attacking play style.

[ Racket ID: 2 - Victor Thruster K Falcon 4U ]
Price: RM 620
Weight: 4U
Flex: Medium Flex
Balance: Even Balance
Location: Petaling Jaya
Product link: Victor Thruster K Falcon 4U | /products/2
```

## 16. Fallback Behavior

If the `.joblib` model does not exist:

```text
The ML recommender is not available yet, Boss. I will use the basic racket guide for now.
```

Then fallback to the existing rule-based recommendation system.

If model prediction fails:

- Log the error.
- Fallback to rule-based recommendation.
- Do not break chatbot streaming.

If no matching product exists:

- Search broader alternatives.
- Explain the tradeoff clearly.

## 17. Dependencies

Add to `ai_service/requirements.txt`:

```text
scikit-learn
joblib
pandas
```

The deployed AI service should use package versions compatible with the Google Colab environment used to generate the `.joblib` file.

## 18. Non-Goals For MVP

The MVP should not:

- Store standalone chatbot recommendation profiles in the database. The later
  transaction-survey retraining extension stores controlled training examples
  linked to purchased orders.
- Build a separate full-page recommendation form.
- Predict exact product IDs.
- Require users to type profile answers.
- Replace the existing general chatbot.
- Remove the existing beginner recommendation fallback.

## 19. Acceptance Criteria

The feature is complete when:

- Chatbox has a `Recommend Me a Racket` button.
- Button starts the recommendation assessment flow.
- Bot asks one assessment question at a time.
- User can answer each question by pressing buttons.
- Frontend stores structured assessment values.
- Frontend submits `recommendationProfile` to the chat endpoint.
- Go backend forwards `recommendationProfile` to FastAPI.
- AI service can load and use `racket_recommender.joblib`.
- ML model predicts racket specs.
- Predicted specs are used to search marketplace listings.
- Bot returns product cards with product links.
- Missing model file does not crash chatbot.
- Model prediction failure falls back to rule-based recommendation.
- Existing beginner recommendation still works.

## 20. Implementation Phases

### Phase 1: Frontend Assessment UI

- Add `Recommend Me a Racket` button.
- Add assessment state to `AIFloatingChat.tsx`.
- Render one question at a time.
- Render answer options as buttons.
- Store structured selected values.

### Phase 2: API Payload Support

- Extend frontend chat request payload with `recommendationProfile`.
- Extend Go request structs in `backend/ai_chat.go`.
- Forward the optional profile object to FastAPI.
- Extend FastAPI `ChatRequest` model.

### Phase 3: ML Integration

- Add `ai_service/recommender.py`.
- Add `ai_service/ml_models/`.
- Load `racket_recommender.joblib`.
- Add model metadata support.
- Add missing-model fallback.

### Phase 4: Recommendation Tool

- Add `get_profile_based_recommendations` to `ai_service/tools.py`.
- Convert model prediction into product filters.
- Search current listings through the existing backend API.
- Format final recommendation response.

### Phase 5: Testing

- Test assessment start button.
- Test every answer option.
- Test completed profile submission.
- Test missing `.joblib` file.
- Test dummy `.joblib` model.
- Test no exact product matches.
- Test fallback recommendations.
- Test product links in chatbot output.
- Test existing chat behavior still works.

## 21. Recommended MVP Decision

For version 1:

- Use a chatbot button to start assessment.
- Ask one question at a time.
- Use button-based answers only.
- Do not store profile data in the database.
- Use a MultiOutput Random Forest Classifier.
- Predict racket specs, not product IDs.
- Search current marketplace listings after prediction.
- Keep rule-based beginner recommendation as fallback.

## 22. Transaction-Survey Retraining Extension

The deployed application extends the original inference-only MVP with a
demo-first retraining loop:

1. A pending or completed buyer order may submit one controlled five-field
   recommendation survey.
2. The Go backend snapshots the purchased listing's weight, flexibility, and
   balance values as the row's three training targets.
3. PostgreSQL stores survey rows and durable administrator/moderator training
   runs.
4. The AI service combines the immutable 1,000-row synthetic CSV with all
   survey rows and writes a reproducible training snapshot.
5. The existing MultiOutput Random Forest pipeline trains in a background
   worker and reports stage-based progress.
6. A validated candidate is stored in the persistent recommender model volume
   and activated through an atomic manifest update without interrupting chat
   predictions.

This extension intentionally demonstrates that the model can relearn from new
transaction data. It does not require a minimum number of survey rows or a
quality-regression gate before activation.
