# OG LEDGER — Community Rewards Infrastructure
### bags.fm Hackathon Entry

> *"We believed first. Now we build."*

---

## Project Overview

**OG LEDGER** is a community rewards infrastructure built on the Bags.fm platform.
It enables bags.fm OG members to launch tokens, earn fee shares, and claim rewards —
all through deep integration with the Bags API.

OG members who invested 1.5–3 SOL during the early recruitment period (Jan–Mar 2024)
are verified on-chain and gain access to exclusive tools:

> **"We're not just early supporters — we're building the rewards layer."**

---

## Architecture

### Web App (`og_ledger.html`)
| Section | Feature |
|---------|---------|
| **01 SCAN** | Extract wallets that sent 1.5/3 SOL to bags.fm official wallet |
| **02 LEDGER** | OG investment dashboard, timeline, community stats |
| **03 NFT** | OG certificate NFT claim via Metaplex |
| **04 REWARDS** | Token launch, fee claiming, swap — powered by Bags API |

### Backend (`server/`)
| Component | Stack |
|-----------|-------|
| **API Server** | Node.js / TypeScript / Express |
| **Database** | SQLite (better-sqlite3) |
| **Bags API Client** | 16 endpoints — Token Launch, Fee Share, Swap, Analytics |
| **OG Verification** | On-chain Solana RPC verification |

### Telegram Bot (`telegram_bot_v2.py`)
| Command | Feature |
|---------|---------|
| `/verify [wallet]` | On-chain OG status verification via Solana RPC |
| `/launch` | Launch a new token via Bags API |
| `/claim` | Claim accumulated fee rewards |
| `/portfolio` | View your OG portfolio and earnings |
| `/status` | Community stats and platform metrics |
| `/list` | Verified OG member registry |

---

## Bags API Integration

OG LEDGER deeply integrates with the Bags API across 7 categories:

| Category | Endpoints | Use Case |
|----------|-----------|----------|
| **Token Launch** | create-token-info, create-launch-tx | OG members launch community tokens |
| **Fee Share** | create-config, wallet-lookup, admin | Configure fee distribution for OG community |
| **Partner** | create-config, stats, claim | Platform-level partner fee revenue |
| **Fee Claiming** | claimable-positions, claim-tx/v3 | OGs claim their earned fees |
| **Trade** | quote, swap | Swap tokens within the platform |
| **Analytics** | lifetime-fees, claim-stats, claim-events, creators | Track revenue and community metrics |
| **State** | bags-pools, bags-pool | Pool data and market state |

### Revenue Model

```
Trading Volume on OG-launched tokens
  └── 1% Creator Fee (goes to token launcher)
      └── 25% Partner Fee (goes to OG LEDGER platform)
          └── Distributed to OG community via Fee Share Config
```

---

## Quick Start

### Backend
```bash
cd server
npm install
npm run dev    # Development (nodemon + ts-node)
npm run build  # Production build
npm start      # Production run
```

### Web App
```bash
# Open directly in browser
open og_ledger.html

# Or serve locally
python -m http.server 8080
```

### Telegram Bot
```bash
pip install python-telegram-bot aiohttp apscheduler
python telegram_bot_v2.py
```

### Free-First Setup (Korean)

비개발자용 무료 운영 가이드는 아래 문서를 참고하세요.

- `FREE_SETUP_KO.md`

---

## On-chain Data

- **BAGS Official Wallet**: `3nCpr7qw5mGVXofKS75PLNvv5xfJE3wY9c5JKDGPeAd2`
- **Explorer**: [Solscan](https://solscan.io/account/3nCpr7qw5mGVXofKS75PLNvv5xfJE3wY9c5JKDGPeAd2)
- **Network**: Solana Mainnet

---

## Hackathon Categories

- **Fee Sharing** (Primary) — Deep Bags fee share integration with partner config
- **Social Finance** (Secondary) — Community-driven token launches and collective rewards
- **Bags API** — 16 endpoint integration across all Bags API categories

---

`#BagsOG` `#OGLedger` `#BagsFM` `#Hackathon2026`
