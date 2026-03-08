# OG LEDGER 무료 운영 가이드 (비개발자용)

이 문서는 "돈 거의 안 쓰고" OG LEDGER를 운영하는 현실적인 기본안을 설명합니다.

## 1) 먼저 결론 (가장 쉬운 무료 조합)

- 프론트엔드(`og_ledger.html`): GitHub Pages (무료)
- 백엔드 + 텔레그램 봇: 내 PC/VPS 1대에서 실행
- Solana RPC: 우선 `https://api.mainnet.solana.com`로 시작(무료, 단 rate limit 있음)
- X 모니터링: 기본은 RSS 모드(`X_SOURCE=rss`)로 사용

## 2) 왜 이 조합이 무료에 유리한가

- GitHub Pages는 정적 파일 배포가 무료입니다.
- 봇/백엔드는 같은 서버에서 같이 돌리면 운영 복잡도가 낮습니다.
- Solana 공식 public RPC는 무료지만, 트래픽이 많으면 제한이 걸릴 수 있습니다.
- X 공식 API는 2026 기준 pay-per-usage라, 기본은 RSS 모드가 비용 절감에 유리합니다.

## 3) 환경변수 최소 세팅

`.env`에 아래를 먼저 채우세요.

```env
BOT_TOKEN=...
CHANNEL_ID=-100...
GROUP_ID=-100...
BAGS_WALLET=3nCpr7qw5mGVXofKS75PLNvv5xfJE3wY9c5JKDGPeAd2
SOLANA_RPC=https://api.mainnet.solana.com
ADMIN_TG_ID=...
BAGS_APIKEY=...
API_SECRET=...
BACKEND_URL=http://localhost:3001

# 공지 모니터링 (무료 우선)
X_SOURCE=rss
RSS_FEEDS=https://example.com/feed.xml
TWITTER_BEARER=
```

## 4) 실행 순서

1. 백엔드 실행

```bash
cd server
npm install
npm run dev
```

2. 봇 실행

```bash
pip install python-telegram-bot aiohttp apscheduler
python telegram_bot_v2.py
```

3. 프론트 실행(로컬 테스트)

```bash
python -m http.server 8080
```

브라우저에서 `http://localhost:8080/og_ledger.html` 접속.

## 5) 무료 운영 시 한계 (중요)

- Solana public RPC는 production 전용이 아닙니다. 요청이 많으면 429/403이 날 수 있습니다.
- RSS 소스(특히 비공식 X 미러)는 가끔 끊길 수 있습니다.
- 무료 환경은 "항상 안정적"이 아니라 "best-effort"라고 생각하는 게 맞습니다.

## 6) 트래픽 늘면 업그레이드 순서

1. RPC부터 업그레이드 (Helius/Alchemy/dRPC 등 free tier -> 유료)
2. 봇/백엔드 실행 환경 상시화(systemd/pm2)
3. X 공지 정확도가 매우 중요하면 공식 API로 전환

## 7) 참고 링크 (공식 문서 위주)

- Solana clusters / public RPC limits: `https://solana.com/docs/references/clusters`
- Cloudflare Workers limits: `https://developers.cloudflare.com/workers/platform/limits/`
- Cloudflare Quick Tunnel(개발용): `https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/`
- Oracle Always Free: `https://docs.oracle.com/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm`
- X Developer (pay-per-usage 안내): `https://developer.x.com/en/docs/x-api`
