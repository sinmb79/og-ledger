# OG LEDGER — Telegram 셋업 완전 가이드

## 전체 구조

```
📢 채널  @OGLedgerChannel   ← 자동 공지 전용 (읽기만)
    │
    └── 연결 (Discussion Group)
    
💬 그룹  @OGLedgerChat      ← 토론 + 봇 명령어
    │
    └── 봇 추가
    
🤖 봇    @OGLedgerBot       ← 인증/서명/자동포스팅
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
→ bags.fm OG 멤버 집단 청원 봇 | OG Member Accountability Protocol

/setabouttext  
→ /verify [지갑] → /sign 으로 OG 청원에 참여하세요

/setuserpic
→ OG LEDGER 로고 이미지 업로드

/setcommands
→ 아래 명령어 목록 붙여넣기:
```

**명령어 목록 (BotFather에 그대로 붙여넣기):**
```
start - OG LEDGER 시작 / Start
verify - OG 자격 인증 / Verify OG status
sign - 청원 서명 / Sign petition
status - 서명 현황 / View status
demand - 공식 요구문 / Official demand
list - 서명자 목록 / List signers
```

---

## STEP 2 — 채널 생성

1. Telegram 앱 → 새 채널 만들기
2. 이름: **OG LEDGER**
3. 설명:
   ```
   bags.fm OG 멤버 공식 채널
   Official channel for bags.fm OG member accountability
   
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
   /verify [지갑주소] 로 OG 인증 후 /sign 으로 청원 참여
   
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
export TWITTER_BEARER="..."                    # 선택: 트위터 모니터링
```

### 의존성 설치

```bash
pip install python-telegram-bot aiohttp apscheduler
```

Twitter 모니터링 사용 시:
```bash
pip install tweepy
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

## STEP 7 — 트위터 모니터링 설정 (선택)

1. [developer.twitter.com](https://developer.twitter.com) 에서 앱 생성
2. **Free tier** 로도 읽기 전용 API 사용 가능
3. Bearer Token 발급 → `TWITTER_BEARER` 환경변수 설정
4. bags.fm 공식 트위터 새 트윗 → 30분마다 자동 체크 → 채널 알림

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
- [ ] `/sign` 테스트 → 채널 자동 포스팅 확인
- [ ] 웹앱 `og_ledger.html` Telegram 링크 업데이트

---

## 채널 첫 핀 메시지 (복사용)

```
📌 OG LEDGER 채널에 오신 것을 환영합니다

bags.fm은 2024년 1월 OG 멤버를 모집했습니다.
수백 명이 1.5~3 SOL을 직접 투자했습니다.
그 기록은 Solana 블록체인에 영원히 남아 있습니다.

오늘로 [N]일째, 체계적 보상은 없습니다.

━━━━━━━━━━━━━━━━━

이 채널은:
📊 매일 경과일 카운터 자동 포스팅
✍️ 새 서명자 현황 실시간 업데이트
📡 bags.fm 공식 트위터 모니터링 알림

━━━━━━━━━━━━━━━━━

OG 멤버라면 → @OGLedgerChat 에서 서명
/verify [지갑주소] → /sign

🌐 og-ledger.xyz
#BagsOG #OGLedger
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
