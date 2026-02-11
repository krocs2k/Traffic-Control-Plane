# Traffic Control Plane

A comprehensive dashboard for managing database/backend traffic with load balancing, circuit breakers, rate limiting, experiments, and real-time alerting.

## Features

- **Dashboard** - System overview with real-time statistics
- **Backend Management** - Manage backend clusters and individual backends
- **Read Replicas** - Lag-aware routing for read replicas
- **Health Monitoring** - Track backend health status
- **Traffic Metrics** - Visualize requests, latency, and error rates
- **Circuit Breakers** - Protect services from cascading failures
- **Rate Limiting** - Control traffic with configurable rules
- **Experiments** - A/B testing, canary deployments, and feature flags
- **Load Balancing** - Multiple algorithms (Round Robin, Least Connections, etc.)
- **Real-time Alerting** - Threshold-based alerts with multiple channels
- **Traffic Endpoints** - Dynamic URL ingestion points
- **Notifications** - In-app notification system
- **AI Recommendations** - Intelligent optimization suggestions
- **Audit Logging** - Complete action history
- **Multi-Factor Authentication** - TOTP and backup codes

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Database:** PostgreSQL with Prisma ORM
- **Auth:** NextAuth.js with MFA support
- **UI:** Tailwind CSS + shadcn/ui
- **Charts:** Recharts

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL database
- Yarn package manager

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/krocs2k/Traffic-Control-Plane.git
   cd Traffic-Control-Plane
   ```

2. Install dependencies:
   ```bash
   yarn install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration (see Environment Variables below)
   ```

4. Initialize the database:
   ```bash
   yarn prisma generate
   yarn prisma db push
   yarn prisma db seed
   ```

5. Run the development server:
   ```bash
   yarn dev
   ```

6. Open [http://localhost:3000](http://localhost:3000)

### Docker Deployment

```bash
docker build -t traffic-control-plane .
docker run -p 3000:3000 --env-file .env traffic-control-plane
```

## Environment Variables

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `DATABASE_URL` | Yes | PostgreSQL connection string | - |
| `NEXTAUTH_URL` | Yes | Full URL of your deployment | `http://localhost:3000` |
| `NEXTAUTH_SECRET` | Yes | Secret for NextAuth.js sessions | - |
| `LLM_API_KEY` or `OPENAI_API_KEY` | No | API key for AI features (recommendations, routing assistant) | - |
| `LLM_API_BASE_URL` | No | Base URL for OpenAI-compatible LLM API | `https://api.openai.com/v1` |
| `LLM_MODEL` | No | LLM model to use | `gpt-4o-mini` |
| `PLATFORM_DOMAINS` | No | Comma-separated list of platform domains to skip in middleware | - |

### AI Features (Optional)

The AI-powered features (routing policy assistant, infrastructure recommendations) require an OpenAI-compatible API. You can use:
- **OpenAI**: Set `OPENAI_API_KEY` 
- **Azure OpenAI**: Set `LLM_API_BASE_URL` and `LLM_API_KEY`
- **Any OpenAI-compatible provider**: Configure `LLM_API_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL`

## Demo Credentials

**Primary Test Account:**
- Email: `john@doe.com`
- Password: `Test123!`

**Demo Users (password: `password123`):**
- alice@acme.com (Admin)
- bob@acme.com (Operator)
- carol@techstart.com
- dave@techstart.com
- eve@external.com

## License

MIT
