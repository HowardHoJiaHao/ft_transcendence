# Transcendence Module Checklist

Use this document to record which modules are implemented and calculate the final score.

## Scoring

- **Major module:** 2 points
- **Minor module:** 1 point
- **Current score:** 31 points
- **Maximum score:** 79 points

When a module is confirmed as complete, check its main checkbox and add its point value to the current score. A module with prerequisites can only be claimed after those prerequisites are functional.

## IV.1 Web

- [x] **Major — Frontend and backend frameworks (2 points)**
  - [x] Use a frontend framework such as React, Vue, Angular, or Svelte.
  - [x] Use a backend framework such as Express, NestJS, Django, Flask, or Rails.
  - [x] A full-stack framework counts only when both its frontend and backend capabilities are used.

- [ ] **Minor — Frontend framework (1 point)**
  - [ ] Use a frontend framework such as React, Vue, Angular, or Svelte.

- [ ] **Minor — Backend framework (1 point)**
  - [ ] Use a backend framework such as Express, Fastify, NestJS, or Django.

- [x] **Major — Real-time features (2 points)**
  - [x] Implement real-time updates across clients using WebSockets or similar technology.
  - [x] Handle connection and disconnection gracefully.
  - [x] Use efficient message broadcasting.

- [x] **Major — User interaction (2 points)**
  - [x] Provide a basic chat system for sending and receiving messages between users.
  - [x] Provide a profile system for viewing user information.
  - [x] Provide a friends system for adding and removing friends and viewing the friends list.

- [x] **Major — Secured public database API (2 points)**
  - [x] Provide a public API secured with API keys.
  - [x] Implement rate limiting.
  - [x] Provide API documentation.
  - [x] Implement at least five endpoints.
  - [x] Include at least one `GET /api/{something}` endpoint.
  - [x] Include at least one `POST /api/{something}` endpoint.
  - [x] Include at least one `PUT /api/{something}` endpoint.
  - [x] Include at least one `DELETE /api/{something}` endpoint.

- [x] **Minor — ORM (1 point)**
  - [x] Use an ORM for database access.

- [x] **Minor — Complete notification system (1 point)**
  - [x] Notify users about creation actions.
  - [x] Notify users about update actions.
  - [x] Notify users about deletion actions.

- [ ] **Minor — Real-time collaboration (1 point)**
  - [ ] Implement a collaborative feature such as shared workspaces, live editing, or collaborative drawing.

- [ ] **Minor — Server-Side Rendering (1 point)**
  - [ ] Use SSR to improve performance and SEO.

- [ ] **Minor — Progressive Web App (1 point)**
  - [ ] Provide offline support.
  - [ ] Support installation as a PWA.

- [x] **Minor — Custom design system (1 point)** 
  - [x] Create a reusable component-based design system.
  - [x] Define a proper color palette.
  - [x] Define typography.
  - [x] Provide an icon system.
  - [x] Implement at least 10 reusable components.

- [x] **Minor — Advanced search (1 point)**
  - [x] Provide search filters.
  - [x] Provide sorting.
  - [x] Provide pagination.

- [x] **Minor — File upload and management (1 point)**
  - [x] Support multiple file types, including images and documents.
  - [x] Validate type, size, and format on the client.
  - [x] Validate type, size, and format on the server.
  - [x] Store files securely with proper access control.
  - [x] Provide file previews where applicable.
  - [x] Display upload progress indicators.
  - [x] Allow users to delete uploaded files.

## IV.2 Accessibility and Internationalization

- [ ] **Major — WCAG 2.1 AA accessibility (2 points)**
  - [ ] Support screen readers.
  - [ ] Support keyboard navigation.
  - [ ] Support assistive technologies.
  - [ ] Meet WCAG 2.1 AA requirements.

- [x] **Minor — Multiple languages (1 point)**
  - [x] Implement an internationalization system.
  - [x] Provide at least three complete language translations.
  - [x] Provide a language switcher in the UI.
  - [x] Make all user-facing text translatable.

- [ ] **Minor — Right-to-left language support (1 point)**
  - [ ] Support at least one RTL language, such as Arabic or Hebrew.
  - [ ] Mirror the complete layout, not only the text direction.
  - [ ] Include RTL-specific UI adjustments where needed.
  - [ ] Support seamless LTR and RTL switching.

- [x] **Minor — Additional browser support (1 point)**
  - [x] Support at least two additional browsers, such as Firefox, Safari, or Edge.
  - [x] Test and fix all features in each supported browser.
  - [x] Document browser-specific limitations.
  - [x] Maintain consistent UI and UX across supported browsers.

## IV.3 User Management

- [x] **Major — Standard user management and authentication (2 points)**
  - [x] Allow users to update their profile information.
  - [x] Allow users to upload an avatar.
  - [x] Provide a default avatar when no avatar is uploaded.
  - [x] Allow users to add other users as friends.
  - [x] Display users' online status.
  - [x] Provide a profile page displaying user information.

- [ ] **Minor — Game statistics and match history (1 point)**
  - [ ] Track wins, losses, ranking, level, or equivalent statistics.
  - [ ] Display match history with games, dates, results, and opponents.
  - [ ] Show achievements and progression.
  - [ ] Integrate a leaderboard.
  - [ ] **Prerequisite:** At least one functional game must be implemented.

- [x] **Minor — Remote authentication with OAuth 2.0 (1 point)**
  - [x] Implement OAuth 2.0 authentication through Google, GitHub, 42, or another provider.

- [x] **Major — Advanced permissions system (2 points)**
  - [x] Support viewing users.
  - [x] Support editing users.
  - [x] Support deleting users.
  - [x] Support role management for roles such as admin, user, guest, or moderator.
  - [x] Show different views and actions based on user role.

- [ ] **Major — Organization system (2 points)**
  - [ ] Allow organizations to be created.
  - [ ] Allow organizations to be edited.
  - [ ] Allow organizations to be deleted.
  - [ ] Allow users to be added to organizations.
  - [ ] Allow users to be removed from organizations.
  - [ ] Allow users to view organizations.
  - [ ] Support organization-specific create, read, and update actions.

- [x] **Minor — Two-factor authentication (1 point)**
  - [x] Implement a complete 2FA system for users.

- [ ] **Minor — User activity analytics (1 point)**
  - [ ] Provide an activity analytics and insights dashboard.

## IV.4 Artificial Intelligence

- [ ] **Major — AI opponent for games (2 points)**
  - [ ] Implement an AI opponent for a functional game.
  - [ ] Make the AI challenging and able to win occasionally.
  - [ ] Simulate human-like, non-perfect behavior.
  - [ ] Support game customization options when the game provides them.
  - [ ] Be able to explain the AI implementation during evaluation.

- [x] **Major — Retrieval-Augmented Generation (RAG) system (2 points)**
  - [x] Interact with a large information dataset.
  - [x] Retrieve relevant context for user questions.
  - [x] Generate answers using the retrieved context.

- [x] **Major — Complete LLM system interface (2 points)**
  - [x] Generate text and/or images from user input.
  - [x] Handle streaming responses properly.
  - [x] Handle errors.
  - [x] Apply rate limiting.

- [x] **Major — Machine-learning recommendation system (2 points)**
  - [x] Provide personalized recommendations based on user behavior.
  - [x] Use collaborative filtering or content-based filtering.
  - [x] Continuously improve recommendations over time.

- [ ] **Minor — AI content moderation (1 point)**
  - [ ] Implement automatic moderation, deletion, warnings, or equivalent controls.

- [ ] **Minor — Voice or speech integration (1 point)**
  - [ ] Provide voice or speech functionality for accessibility or interaction.

- [ ] **Minor — Sentiment analysis (1 point)**
  - [ ] Analyze sentiment in user-generated content.

- [ ] **Minor — Image recognition and tagging (1 point)**
  - [ ] Recognize and tag images automatically.

## IV.5 Cybersecurity

- [x] **Major — Hardened WAF/ModSecurity and managed secrets (2 points)**
  - [x] Configure a strict, hardened ModSecurity/WAF layer.
  - [x] Manage API keys, credentials, and environment variables using Infisical as the HashiCorp Vault-equivalent secrets manager.
  - [x] Keep secrets encrypted and isolated.

  > **Evaluation note:** The implementation uses Infisical instead of HashiCorp Vault. This 2-point claim assumes the evaluator accepts an equivalent secure secrets-management platform.

## IV.6 Gaming and User Experience

- [ ] **Major — Complete web-based multiplayer game (2 points)**
  - [ ] Implement a complete web-based game.
  - [ ] Allow users to play against each other.
  - [ ] Define clear rules.
  - [ ] Define win and loss conditions.
  - [ ] Support a 2D or 3D experience.

- [ ] **Major — Remote players (2 points)**
  - [ ] Allow two players on separate computers to play the same game in real time.
  - [ ] Handle network latency gracefully.
  - [ ] Handle disconnections gracefully.
  - [ ] Provide a smooth remote gameplay experience.
  - [ ] Implement reconnection logic.
  - [ ] **Prerequisite:** A functional game must be implemented.

- [ ] **Major — Multiplayer game for more than two players (2 points)**
  - [ ] Support at least three simultaneous players.
  - [ ] Provide fair gameplay mechanics.
  - [ ] Synchronize all clients correctly.
  - [ ] **Prerequisite:** A functional game must be implemented.

- [ ] **Major — Second game with history and matchmaking (2 points)**
  - [ ] Implement a second distinct game.
  - [ ] Track user history and statistics for the second game.
  - [ ] Implement matchmaking.
  - [ ] Maintain performance and responsiveness.
  - [ ] **Prerequisite:** A first functional game must be implemented.

- [ ] **Major — Advanced 3D graphics (2 points)**
  - [ ] Use a library such as Three.js or Babylon.js.
  - [ ] Create an immersive 3D environment.
  - [ ] Implement advanced rendering techniques.
  - [ ] Ensure smooth performance and user interaction.

- [ ] **Minor — Advanced chat features (1 point)**
  - [ ] Allow users to block other users from messaging them.
  - [ ] Allow users to invite others to games directly from chat.
  - [ ] Display game or tournament notifications in chat.
  - [ ] Link to user profiles from chat.
  - [ ] Persist chat history.
  - [ ] Provide typing indicators.
  - [ ] Provide read receipts.
  - [ ] **Prerequisite:** Basic chat must be implemented.

- [ ] **Minor — Tournament system (1 point)**
  - [ ] Provide a clear matchup order and bracket system.
  - [ ] Track who plays against whom.
  - [ ] Provide matchmaking for tournament participants.
  - [ ] Support tournament registration and management.
  - [ ] **Prerequisite:** A functional game must be implemented.

- [ ] **Minor — Game customization (1 point)**
  - [ ] Provide power-ups, attacks, or special abilities.
  - [ ] Provide different maps or themes.
  - [ ] Provide customizable game settings.
  - [ ] Provide sensible default options.
  - [ ] **Prerequisite:** A functional game must be implemented.

- [ ] **Minor — Gamification system (1 point)**
  - [ ] Implement at least three of: achievements, badges, leaderboards, XP/levels, daily challenges, or rewards.
  - [ ] Persist the system in the database.
  - [ ] Provide visual feedback such as notifications or progress bars.
  - [ ] Define clear rules and progression mechanics.

- [ ] **Minor — Spectator mode (1 point)**
  - [ ] Allow users to watch ongoing games.
  - [ ] Provide real-time updates for spectators.
  - [ ] Optionally provide spectator chat.
  - [ ] **Prerequisite:** A functional game must be implemented.

## IV.7 DevOps

- [ ] **Major — ELK log management (2 points)**
  - [ ] Use Elasticsearch to store and index logs.
  - [ ] Use Logstash to collect and transform logs.
  - [ ] Use Kibana for visualization and dashboards.
  - [ ] Implement log retention and archiving policies.
  - [ ] Secure access to all ELK components.

- [x] **Major — Prometheus and Grafana monitoring (2 points)**
  - [x] Set up Prometheus to collect metrics.
  - [x] Configure exporters and integrations.
  - [x] Create custom Grafana dashboards.
  - [x] Configure alerting rules.
  - [x] Secure access to Grafana.

- [ ] **Major — Backend microservices (2 points)**
  - [ ] Design loosely coupled services with clear interfaces.
  - [ ] Give each service a single responsibility.
  - [ ] Use REST APIs or message queues for service communication.

- [x] **Minor — Health checks, status page, and disaster recovery (1 point)**
  - [x] Provide health checks.
  - [x] Provide a status page.
  - [x] Automate backups.
  - [x] Document and test disaster recovery procedures.

## IV.8 Data and Analytics

- [ ] **Major — Advanced analytics dashboard (2 points)**
  - [ ] Provide interactive charts and graphs, such as line, bar, and pie charts.
  - [ ] Provide real-time data updates.
  - [ ] Provide export functionality, such as PDF or CSV.
  - [ ] Support customizable date ranges.
  - [ ] Support dashboard filters.

- [ ] **Minor — Data export and import (1 point)**
  - [ ] Export data in multiple formats, such as JSON, CSV, or XML.
  - [ ] Import data with validation.
  - [ ] Support bulk operations.

- [ ] **Minor — GDPR compliance features (1 point)**
  - [ ] Allow users to request their data.
  - [ ] Allow users to delete their data after confirmation.
  - [ ] Export user data in a readable format.
  - [ ] Send confirmation emails for data operations.

## IV.9 Blockchain

- [ ] **Major — Store tournament scores on blockchain (2 points)**
  - [ ] Use Avalanche and Solidity smart contracts on a test blockchain.
  - [ ] Record tournament scores.
  - [ ] Manage tournament scores.
  - [ ] Retrieve tournament scores.
  - [ ] Ensure data integrity and immutability.

- [ ] **Minor — ICP blockchain backend (1 point)**
  - [ ] Implement a backend running on the Internet Computer Protocol.
  - [ ] Note: This module is incompatible with SSR.

## IV.10 Modules of Choice

- [ ] **Major — Custom module (2 points)**
  - [ ] Implement a substantial module not listed above.
  - [ ] Demonstrate meaningful technical complexity.
  - [ ] Explain in `README.md` why the module was chosen.
  - [ ] Explain which technical challenges it addresses.
  - [ ] Explain how it adds value to the project.
  - [ ] Justify why it deserves Major status.
  - [ ] Avoid shortcuts or trivial implementations.
  - [ ] Ensure the module is relevant to the project context.

- [ ] **Minor — Custom module (1 point)**
  - [ ] Implement a meaningful smaller-scope module not listed above.
  - [ ] Demonstrate technical skill and creativity.
  - [ ] Explain in `README.md` why the module was chosen.
  - [ ] Explain which technical challenges it addresses.
  - [ ] Explain how it adds value to the project.
  - [ ] Justify why it deserves Minor status.

## Score Log

| Module | Status | Points |
| --- | --- | ---: |
| IV.1 Web | Assessed — selected modules complete | 12 |
| IV.2 Accessibility and Internationalization | Assessed — multilingual module complete | 1 |
| IV.3 User Management | Assessed — selected modules complete | 6 |
| IV.4 Artificial Intelligence | Assessed — selected modules complete | 6 |
| IV.5 Cybersecurity | Assessed — Infisical accepted as Vault equivalent | 2 |
| IV.6 Gaming and User Experience | Not assessed | 0 |
| IV.7 DevOps | Assessed — selected modules complete | 3 |
| IV.8 Data and Analytics | Not assessed | 0 |
| IV.9 Blockchain | Not assessed | 0 |
| IV.10 Modules of Choice | Not assessed | 0 |
| **Total** | **Assessed** | **31 / 79** |

## Final Score

**31 points**
