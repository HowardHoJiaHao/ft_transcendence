# Transcendence Architecture Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER (Browser)                            │
│                                                                             │
│                    ┌──────────────────────────────────┐                    │
│                    │   Next.js Frontend Application   │                    │
│                    │        (React 18 + TypeScript)   │                    │
│                    │    Port: 3000                    │                    │
│                    └──────────┬───────────────────────┘                    │
└─────────────────────────────────┼──────────────────────────────────────────┘
                                  │
                    HTTP/REST API │ (CORS Enabled)
                                  │
┌─────────────────────────────────▼──────────────────────────────────────────┐
│                        TRANSCENDENCE NETWORK                               │
│                     (Docker Bridge Network)                                │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │                      API LAYER (Backend)                            │ │
│  │                                                                      │ │
│  │        ┌────────────────────────────────────────────────┐           │ │
│  │        │   Go Echo Server                              │           │ │
│  │        │   - REST API Endpoints                        │           │ │
│  │        │   - Request Routing                           │           │ │
│  │        │   - CORS Middleware                           │           │ │
│  │        │   - Authentication/Authorization              │           │ │
│  │        │   - Rate Limiting                             │           │ │
│  │        │   Port: 8080                                  │           │ │
│  │        └────────────────┬─────────────────────────────┘           │ │
│  │                         │                                         │ │
│  │                  SQL Queries                                      │ │
│  │                         │                                         │ │
│  │        ┌────────────────▼─────────────────────────────┐           │ │
│  │        │   MySQL Database                            │           │ │
│  │        │   - User Management                         │           │ │
│  │        │   - Listings & Products                     │           │ │
│  │        │   - Orders & Transactions                   │           │ │
│  │        │   - Messages & Reviews                      │           │ │
│  │        │   - Analytics Events                        │           │ │
│  │        │   - API Keys & Rate Limits                  │           │ │
│  │        │   Port: 3306                                │           │ │
│  │        │   Volume: mysql_data (persistent)           │           │ │
│  │        └────────────────────────────────────────────┘           │ │
│  │                                                                  │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

## Service Communication Flow

```
User Browser
    │
    ├─ GET /                          ─────────────→  Next.js Frontend (3000)
    │
    ├─ API Calls                      ─────────────→  Go Backend (8080)
    │                                                      │
    │                                                      ├─ Parse Request
    │                                                      ├─ Authenticate
    │                                                      ├─ Query Database
    │                                                      └─ Return JSON
    │
    ├─ WebSocket (Future)             ─────────────→  Real-time Updates
    │
    └─ Static Assets                  ─────────────→  Next.js Cache
```

## Data Flow - Example: User Registration

```
Browser (Frontend)
    │
    ├─→ POST /api/v1/auth/register
    │   {username, email, password}
    │
    └─→ Next.js Handler
        │
        └─→ axios.post('http://localhost:8080/...')
            │
            └─→ Go Backend (Handler)
                │
                ├─ Validate Input
                ├─ Hash Password
                ├─ Check Email Uniqueness
                │
                └─→ INSERT INTO users (...)
                    │
                    └─→ MySQL Database
                        │
                        └─→ RETURN user_id, token
                        │
                └─→ Go Backend Response
                    │
                    └─→ Next.js Frontend
                        │
                        └─→ Browser Display
```

## Database Schema Relationships

```
┌──────────────┐
│    users     │◄──────────────────┐
├──────────────┤                   │
│ id           │                   │
│ username     │                   │
│ email        │                   │
│ password_hash│                   │
│ avatar_url   │                   │
└──────┬───────┘                   │
       │                           │
       ├─┐                    ┌────┴──────┐
       │ │                    │            │
       │ └──┐            ┌────┴────┐      │
       │    ├────────────┤ messages ├─────┘
       │    │            └──────────┘
       │    │
       │    ├────────────────┐
       │    │                │
       │  ┌─┴────────┐   ┌───┴──────────┐
       │  │ listings │   │    reviews   │
       │  ├──────────┤   ├──────────────┤
       │  │seller_id◄┼───┤ reviewee_id  │
       │  │title     │   │ reviewer_id  │
       │  │price     │   │ rating       │
       │  │category  │   └──────────────┘
       │  └────┬─────┘
       │       │
       │   ┌───┴────────────┐
       │   │ listing_images │
       │   ├────────────────┤
       │   │ listing_id     │
       │   │ image_url      │
       │   └────────────────┘
       │
       │   ┌────────────────┐
       │   │    orders      │
       │   ├────────────────┤
       │   │ buyer_id       │
       │   │ seller_id      │
       │   │ listing_id     │
       │   └────────────────┘
       │
       └───► api_keys
            ├─────────────┤
            │ key_hash    │
            │ rate_limit  │
            └─────────────┘
```

## Network Communication

```
┌─────────────────────────────────────────────────────────────────┐
│                        HOST MACHINE                             │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              Docker Network Bridge                          │ │
│  │       (transcendence-network)                              │ │
│  │                                                            │ │
│  │  Frontend Container     Backend Container   DB Container  │ │
│  │  ┌──────────────────┐   ┌──────────────┐   ┌────────────┐ │ │
│  │  │   Next.js:3000   │   │ Go:8080      │   │MySQL:3306  │ │ │
│  │  │                  │   │              │   │            │ │ │
│  │  │  Hostname: front ┼──►│ http://back  │   │host: db    │ │ │
│  │  │                  │   │              │   │            │ │ │
│  │  └──────────────────┘   │ MySQL via    │   │            │ │ │
│  │           ▲              │ tcp(db:3306) ►   │            │ │ │
│  │           │              │              │   │            │ │ │
│  │           │              └──────────────┘   └────────────┘ │ │
│  │           │                    ▲                           │ │
│  │           └────────────────────┘                           │ │
│  │                                                            │ │
│  │              Port Mappings (Host)                          │ │
│  │  3000:3000  ◄─ Frontend                                   │ │
│  │  8080:8080  ◄─ Backend                                    │ │
│  │  3306:3306  ◄─ Database                                   │ │
│  │                                                            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
        ▲
        │ HTTP/REST Calls from Browser
        │
   Web Browser (localhost:3000, localhost:8080, localhost:3306)
```

## Development Workflow

```
Developer Machine
│
├─ Edit Code
│  ├─ frontend/src/*.tsx    ─────► Hot Reload ─► Browser reflects changes
│  ├─ backend/main.go       ─────► Rebuild   ─► API reflects changes
│  └─ db/init.sql           ─────► Restart   ─► Schema updated
│
├─ Run Commands
│  ├─ make logs             ─────► View Container Logs
│  ├─ make shell-backend    ─────► Access Container
│  └─ make db-connect       ─────► Access Database
│
├─ Test Changes
│  ├─ http://localhost:3000 ─────► Frontend UI
│  ├─ curl http://localhost:8080/api/v1/* ─► API
│  └─ Postman/Insomnia      ─────► API Testing
│
└─ Deploy
   ├─ docker-compose build  ─────► Build Images
   ├─ docker push           ─────► Push to Registry
   └─ Deploy to Server      ─────► Production
```

## Security Architecture (To Implement)

```
Internet
    │
    ├─ WAF (Web Application Firewall)
    │  ├─ Rate Limiting
    │  ├─ DDoS Protection
    │  └─ SQL Injection Prevention
    │
    ├─ HTTPS/TLS
    │
    ├─ Frontend (CORS Protected)
    │  │
    │  ├─ Next.js Auth Middleware
    │  └─ JWT Token Validation
    │
    ├─ Backend API Gateway
    │  │
    │  ├─ Authentication
    │  ├─ Authorization (RBAC)
    │  └─ Rate Limiting per User/API Key
    │
    ├─ HashiCorp Vault
    │  ├─ Secrets Management
    │  ├─ Encryption Keys
    │  └─ Database Credentials
    │
    └─ Database
       ├─ Encrypted Passwords (bcrypt)
       ├─ Row-Level Security
       └─ Encrypted Sensitive Data
```

## Monitoring & Analytics (To Implement)

```
Applications
├─ Frontend Error Tracking (Sentry)
├─ Backend Logging (ELK Stack)
└─ Database Monitoring
    │
    ├─ Prometheus
    │  ├─ Metrics Collection
    │  ├─ Query Performance
    │  └─ Resource Usage
    │
    ├─ Grafana
    │  ├─ Dashboards
    │  ├─ Alerts
    │  └─ Visualization
    │
    └─ Custom Analytics
       ├─ User Behavior Tracking
       ├─ Business Metrics
       └─ Marketplace KPIs
```

## Deployment Architecture (Future)

```
┌─ Kubernetes Cluster (or Docker Swarm)
│
├─ Ingress Controller
│  └─ HTTPS/TLS Termination
│
├─ Frontend Pods (Replicas: 3+)
│  ├─ Next.js Instances
│  ├─ Load Balanced
│  └─ Auto-scaled
│
├─ Backend Pods (Replicas: 3+)
│  ├─ Go Instances
│  ├─ Load Balanced
│  └─ Auto-scaled
│
├─ Database
│  ├─ Primary + Replicas
│  ├─ Backup Strategy
│  └─ High Availability
│
├─ Cache Layer (Redis)
│  └─ Session & Data Cache
│
├─ Message Queue (RabbitMQ/Kafka)
│  └─ Event Processing
│
└─ External Services
   ├─ OAuth Providers (Google, 42)
   ├─ Payment Gateway
   ├─ Email Service
   ├─ File Storage (S3)
   └─ CDN
```

## Technology Stack Summary

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| **Frontend** | Next.js | 14.0 | Web framework |
| | React | 18.2 | UI library |
| | TypeScript | 5.2 | Type safety |
| | Axios | 1.6 | HTTP client |
| **Backend** | Go | 1.21 | Server runtime |
| | Echo | 4.11 | Web framework |
| | MySQL Driver | 1.7 | Database access |
| **Database** | MySQL | 8.0 | Data storage |
| **DevOps** | Docker | Latest | Containerization |
| | Docker Compose | 3.8 | Orchestration |
| **Future** | Kubernetes | 1.27+ | Container orchestration |
| | Prometheus | Latest | Monitoring |
| | Grafana | Latest | Visualization |
| | HashiCorp Vault | Latest | Secrets management |

---

This architecture is scalable, maintainable, and follows industry best practices for a modern web application marketplace.
