# Contributing to Afristore

First off, thank you for considering contributing to Afristore! It's people like you that make Afristore such a great platform.

## 🚨 Critical Rule: Continuous Integration (CI)

**VERY IMPORTANT:** All CI (Continuous Integration) pipelines **MUST pass** for any Pull Request to be eligible for review and merged. 

We maintain strict quality control. If your PR fails the CI checks (tests, linting, formatting, or build pipelines), reviewers will not look at it or merge it. Please ensure you run all tests locally before pushing!

## Getting Started

Afristore is a monorepo consisting of three main components:
1. **Contracts (`/contracts`)**: Stellar Soroban smart contracts written in Rust.
2. **Frontend (`/frontend`)**: A Next.js/React web application.
3. **Indexer (`/indexer`)**: A Node.js backend using Prisma to index Soroban events.

### Prerequisites
- Node.js (v18+)
- Rust (latest stable) & Soroban CLI
- Docker & Docker Compose (for the Indexer database and Redis)

### Development Setup
1. Clone the repository and navigate into it.
2. Install dependencies via your package manager.
3. Follow the `README.md` for specific instructions on starting the local Stellar network, the indexer database, and the development servers.

## How to Contribute

### 1. Find an Issue
- Check the GitHub issue tracker for open tasks, missing features, and bugs.
- If you're proposing a new feature or reporting a bug, please open an issue first to discuss it with the maintainers.

### 2. Create a Branch
Create a branch using a descriptive naming convention:
- `feat/your-feature-name`
- `fix/your-bug-fix`
- `docs/what-you-documented`
- `test/what-you-are-testing`

### 3. Commit Your Changes
Use clear, conventional commit messages. Examples:
- `feat(marketplace): add buy_item validation`
- `fix(indexer): resolve reorg data corruption`
- `test(launchpad): add symbol length validation tests`

### 4. Submit a Pull Request
- Push your branch to GitHub and open a PR against the `master` branch.
- Fill out the PR template with a clear description of your changes.
- **Ensure all CI workflows turn GREEN.** (If they fail, investigate the logs, fix the issues, and push the updates).
- Request a review from the core maintainers.

## Code Style & Formatting
- **Rust**: Ensure you run `cargo fmt` and `cargo clippy`.
- **TypeScript/JavaScript**: Run the linter and formatters (Prettier/ESLint) before committing to avoid CI pipeline failures.

Thank you for contributing to the future of African digital commerce!
