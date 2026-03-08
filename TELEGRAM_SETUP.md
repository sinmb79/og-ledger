# OG LEDGER — Telegram 셋업 완전 가이드

## 전체 구조

```
📢 채널  @OGLedgerChannel   ← 자동 공지 전용 (읽기만)
    │
    └── 연결 (Discussion Group)
    
💬 그룹  @OGLedgerChat      ← 토론 + 봇 명령어
    │
    └── 봇 추가
    
🤖 봇    @OGLedgerBot       ← 인증/등록/리워드 자동포스팅
```

---

## STEP 1 — BotFather에서 봇 생성

Telegram에서 `@BotFather` 검색 → 시작

```
/newbot
이름: OG LEDGER
username: OGLedgerBot
```

→ **토큰 복사해두기** (예: `7123456789:AAE...`)

봇 설정:
```
/setdescription
→ bags.fm OG 커뮤니티 보상 봇 | OG Community Rewards Bot

/setabouttext  
→ /verify [지갑] → /register 로 OG 커뮤니티에 참여하세요

/setuserpic
→ OG LEDGER 로고 이미지 업로드

/setcommands
→ 아래 명령어 목록 붙여넣기:
```

**명령어 목록 (BotFather에 그대로 붙여넣기):**
```
start - OG LEDGER 시작 / Start
verify - OG 자격 인증 / Verify OG status
register - OG 등록 / Register as OG
launch - 토큰 런칭 / Launch token
claim - 수수료 청구 / Claim fees
portfolio - 포트폴리오 / Portfolio
status - 커뮤니티 현황 / View status
list - 등록 멤버 목록 / List members
```

---

## STEP 2 — 채널 생성

1. Telegram 앱 → 새 채널 만들기
2. 이름: **OG LEDGER**
3. 설명:
   ```
   bags.fm OG 멤버 공식 채널
   Official channel for bags.fm OG community rewards
   
   💬 토론 그룹: @OGLedgerChat
   🌐 웹앱: og-ledger.xyz
   #BagsOG #OGLedger
   ```
4. 채널 유형: **공개 (Public)**
5. 링크: `@OGLedgerChannel`

**채널에 봇을 관리자로 추가:**
- 채널 설정 → 관리자 → 봇 추가
- 권한: **메시지 게시** 만 허용 (나머지 OFF)

---

## STEP 3 — 그룹 생성

1. 새 그룹 만들기
2. 이름: **OG LEDGER Chat**
3. 설명:
   ```
   bags.fm OG 멤버 토론 그룹
    /verify [지갑주소] 로 OG 인증 후 /register 로 커뮤니티 등록
   
   📢 공지 채널: @OGLedgerChannel
   🌐 og-ledger.xyz
   ```
4. 그룹 유형: **공개 (Public)**
5. 링크: `@OGLedgerChat`

**그룹에 봇을 관리자로 추가:**
- 그룹 설정 → 관리자 → 봇 추가
- 권한: **메시지 전송, 메시지 삭제, 멤버 추가** 허용

---

## STEP 4 — 채널 ↔ 그룹 연결 (Discussion Group)

1. **채널** 설정 열기
2. Discussion → 그룹 선택 → `@OGLedgerChat` 연결
3. ✅ 채널 포스트에 자동으로 댓글 그룹 연결됨

---

## STEP 5 — 채널/그룹 ID 확인

봇을 채널/그룹에 추가한 후, 아래 URL에서 ID 확인:

```
https://api.telegram.org/bot[YOUR_TOKEN]/getUpdates
```

또는 `@userinfobot` 에서 그룹/채널 forward하면 ID 확인 가능.

- 채널 ID: 보통 `-100XXXXXXXXXX` 형태
- `@OGLedgerChannel` 형태로도 사용 가능

---

## STEP 6 — 봇 실행

### 환경변수 설정

```bash
export BOT_TOKEN="7123456789:AAE..."          # BotFather 토큰
export CHANNEL_ID="@OGLedgerChannel"          # 또는 -100xxxxx
export GROUP_ID="@OGLedgerChat"               # 또는 -100xxxxx
export BAGS_WALLET="3nCpr7qw5mGVXofKS75PLNvv5xfJE3wY9c5JKDGPeAd2"
export SOLANA_RPC="https://api.mainnet-beta.solana.com"
export ADMIN_TG_ID="YOUR_TELEGRAM_USER_ID"    # /announce 권한
export BACKEND_URL="http://localhost:3001"     # 백엔드 주소
export X_SOURCE="auto"                         # auto | api | rss | disabled
export TWITTER_BEARER=""                       # X API 사용 시에만
export RSS_FEEDS=""                            # RSS 사용 시 쉼표로 여러 개 입력
```

### 의존성 설치

```bash
pip install python-telegram-bot aiohttp apscheduler
```

### 실행

```bash
python telegram_bot_v2.py
```

### 백그라운드 실행 (서버)

```bash
# screen 사용
screen -S ogledger
python telegram_bot_v2.py
# Ctrl+A+D 로 detach

# 또는 systemd 서비스 등록 (권장)
# /etc/systemd/system/ogledger.service 생성
```

---

## STEP 7 — 공지 모니터링 설정 (무료 우선)

### 옵션 A (권장, 무료): RSS 피드 사용

1. `X_SOURCE="rss"` 설정
2. `RSS_FEEDS`에 RSS/Atom URL 입력 (쉼표로 여러 개 가능)
3. `TWITTER_BEARER`는 비워둠

예시:

```bash
export X_SOURCE="rss"
export RSS_FEEDS="https://example.com/feed.xml,https://another.example/rss"
export TWITTER_BEARER=""
```

### 옵션 B (유료 가능): X 공식 API 사용

1. `X_SOURCE="api"` 또는 `auto`
2. X API 크레딧/요금제 준비
3. `TWITTER_BEARER` 설정

예시:

```bash
export X_SOURCE="api"
export TWITTER_BEARER="YOUR_X_BEARER_TOKEN"
```

### 참고

- `auto`는 `TWITTER_BEARER`가 있으면 API, 없으면 RSS를 사용합니다.
- `disabled`는 공지 모니터링을 완전히 끕니다.
- 비공식 X 미러/Nitter 기반 피드는 안정성이 낮고 정책 이슈가 있을 수 있으니, 운영에서는 "best-effort"로만 사용하세요.

---

## STEP 8 — 런치 체크리스트

- [ ] BotFather 봇 생성 완료
- [ ] 채널 `@OGLedgerChannel` 생성 + 봇 관리자 추가
- [ ] 그룹 `@OGLedgerChat` 생성 + 봇 관리자 추가
- [ ] 채널 ↔ 그룹 Discussion 연결
- [ ] 환경변수 설정
- [ ] `python telegram_bot_v2.py` 실행 확인
- [ ] 그룹에서 `/start` 테스트
- [ ] 본인 지갑으로 `/verify` 테스트
- [ ] `/register` 테스트 → 채널 자동 포스팅 확인
- [ ] 웹앱 `og_ledger.html` Telegram 링크 업데이트

---

## 채널 첫 핀 메시지 (복사용)

```
📌 OG LEDGER 채널에 오신 것을 환영합니다

OG LEDGER는 bags.fm OG 멤버를 위한 커뮤니티 보상 인프라입니다.
2024년 초기 참여 지갑(1.5~3 SOL)을 온체인으로 검증하고,
토큰 런칭 · 수수료 청구 · 포트폴리오 추적 기능을 제공합니다.

━━━━━━━━━━━━━━━━━

이 채널은:
📊 커뮤니티 지표 및 보상 현황 자동 업데이트
🚀 신규 토큰 런칭 소식 공유
📡 bags.fm 공식 트위터 모니터링 알림

━━━━━━━━━━━━━━━━━

OG 멤버라면 → @OGLedgerChat 에서 등록 시작
/verify [지갑주소] → /register

추가 명령어: /launch /claim /portfolio /status /list

🌐 og-ledger.xyz
#BagsOG #OGLedger #BagsFM
```

---

## RPC 권장 설정

공식 mainnet-beta는 rate limit이 빡셉니다. 무료 티어 권장:

| 서비스 | 무료 한도 | 링크 |
|--------|-----------|------|
| **Helius** | 100만 req/월 | helius.dev |
| **QuickNode** | 1000만 req/월 | quicknode.com |
| **Alchemy** | 300 CUPS/초 | alchemy.com |

```bash
export SOLANA_RPC="https://mainnet.helius-rpc.com/?api-key=YOUR_KEY"
```

---

`#BagsOG` `#OGLedger` `#BagsFM`
