"""
OG LEDGER — Complete Telegram Bot v2
채널(공지) + 그룹(토론/인증) 통합 운영

구조:
  📢 채널 @OGLedgerChannel  — 자동 공지 전용
  💬 그룹 @OGLedgerChat     — 토론 + 봇 인증/서명
  🤖 봇   @OGLedgerBot      — 그룹 내 명령 처리

자동 포스팅:
  - 매일 00:00 경과일 카운터
  - 새 서명자 환영 (즉시)
  - N번째 서명 마일스톤
  - bags.fm 트위터 모니터링 알림

설치:
  pip install python-telegram-bot aiohttp apscheduler tweepy

환경변수:
  BOT_TOKEN          : 8498124549:AAFCWX68MbJiVUh1L7YqAY1M8jen4ZBqHr0
  CHANNEL_ID         : -1003843659397
  GROUP_ID           : -1003854720078
  BAGS_WALLET        : 3nCpr7qw5mGVXofKS75PLNvv5xfJE3wY9c5JKDGPeAd2
  SOLANA_RPC         : https://api.mainnet-beta.solana.com
  TWITTER_BEARER     : Twitter/X API Bearer Token (모니터링용, 선택)
"""

import os, json, asyncio, aiohttp, logging
from datetime import datetime, timezone
from typing import Optional
from telegram import (
    Update, InlineKeyboardButton, InlineKeyboardMarkup, Bot
)
from telegram.ext import (
    Application, CommandHandler, ContextTypes,
    CallbackQueryHandler, MessageHandler, filters,
    ChatMemberHandler
)
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    level=logging.INFO
)
log = logging.getLogger("OGLedger")

# ─── CONFIG ──────────────────────────────────────────────────────
BOT_TOKEN      = os.getenv("BOT_TOKEN",      "YOUR_BOT_TOKEN")
CHANNEL_ID     = os.getenv("CHANNEL_ID",     "@OGLedgerChannel")
GROUP_ID       = os.getenv("GROUP_ID",       "@OGLedgerChat")
BAGS_WALLET    = os.getenv("BAGS_WALLET",    "3nCpr7qw5mGVXofKS75PLNvv5xfJE3wY9c5JKDGPeAd2")
SOLANA_RPC     = os.getenv("SOLANA_RPC",     "https://api.mainnet-beta.solana.com")
TWITTER_BEARER = os.getenv("TWITTER_BEARER", "")

BAGS_TWITTER_ID = "1609677817947537408"   # @BagsApp Twitter/X user ID
OG_START        = datetime(2024, 1, 5, tzinfo=timezone.utc)
OG_AMOUNTS_LAM  = [1_500_000_000, 3_000_000_000]
TOLERANCE_LAM   = 2_000_000

# 마일스톤 서명자 수 (채널에 자동 공지)
MILESTONES = {10, 25, 50, 100, 200, 500, 1000}

# ─── STORE (프로덕션에서는 SQLite / Redis 교체) ──────────────────
store = {
    "signers":        {},   # wallet → signer_info
    "pending":        {},   # tg_id  → { wallet, sol }
    "last_tweet_id":  None, # 마지막 체크한 트윗 ID
    "last_milestone": 0,    # 마지막 알림 마일스톤
}

# ─── UTILS ───────────────────────────────────────────────────────
def days_since_og() -> int:
    return (datetime.now(timezone.utc) - OG_START).days

def short(addr: str) -> str:
    return f"{addr[:6]}…{addr[-4:]}"

def sol_fmt(lamports: float) -> str:
    return f"{lamports:.1f} SOL"

def signer_stats() -> dict:
    s = store["signers"]
    total_sol = sum(v["sol"] for v in s.values())
    sol3  = sum(1 for v in s.values() if abs(v["sol"] - 3.0) < 0.1)
    sol15 = sum(1 for v in s.values() if abs(v["sol"] - 1.5) < 0.1)
    return {
        "count":     len(s),
        "total_sol": total_sol,
        "sol3":      sol3,
        "sol15":     sol15,
    }

async def rpc(method: str, params: list, retries=3) -> any:
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    for attempt in range(retries):
        try:
            async with aiohttp.ClientSession() as sess:
                async with sess.post(
                    SOLANA_RPC, json=payload,
                    timeout=aiohttp.ClientTimeout(total=20)
                ) as r:
                    data = await r.json()
                    if "error" in data:
                        raise ValueError(data["error"]["message"])
                    return data.get("result")
        except Exception as e:
            if attempt == retries - 1:
                raise
            await asyncio.sleep(1.5 * (attempt + 1))

async def verify_og(wallet: str) -> tuple[bool, float]:
    """온체인에서 OG 자격 확인. (is_og, sol_amount)"""
    from_ts = int(datetime(2024, 1, 1, tzinfo=timezone.utc).timestamp())
    to_ts   = int(datetime(2024, 4, 1, tzinfo=timezone.utc).timestamp())
    try:
        sigs = await rpc("getSignaturesForAddress", [wallet, {"limit": 200}]) or []
        in_range = [s for s in sigs if s.get("blockTime", 0) and from_ts <= s["blockTime"] <= to_ts]

        for sig_info in in_range[:60]:
            tx = await rpc("getTransaction", [
                sig_info["signature"],
                {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0}
            ])
            if not tx or not tx.get("meta"):
                continue

            accs = tx["transaction"]["message"].get("accountKeys", [])
            pre  = tx["meta"].get("preBalances", [])
            post = tx["meta"].get("postBalances", [])

            def addr(a): return a if isinstance(a, str) else a.get("pubkey", "")

            bags_i   = next((i for i, a in enumerate(accs) if addr(a) == BAGS_WALLET), -1)
            wallet_i = next((i for i, a in enumerate(accs) if addr(a) == wallet),       -1)

            if bags_i == -1 or wallet_i == -1:
                continue

            sent = pre[wallet_i] - post[wallet_i]
            recv = post[bags_i]  - pre[bags_i]

            for target in OG_AMOUNTS_LAM:
                if abs(sent - target) <= TOLERANCE_LAM or abs(recv - target) <= TOLERANCE_LAM:
                    return True, target / 1e9

        return False, 0.0
    except Exception as e:
        raise RuntimeError(str(e))


# ─── CHANNEL AUTO-POSTING ────────────────────────────────────────

async def post_to_channel(bot: Bot, text: str, parse_mode="Markdown", kb=None):
    """채널에 메시지 발송."""
    try:
        await bot.send_message(
            chat_id=CHANNEL_ID,
            text=text,
            parse_mode=parse_mode,
            reply_markup=kb,
            disable_web_page_preview=True
        )
        log.info(f"채널 포스팅 완료")
    except Exception as e:
        log.error(f"채널 포스팅 실패: {e}")


async def daily_counter_post(bot: Bot):
    """매일 00:00 경과일 카운터 자동 포스팅."""
    st  = signer_stats()
    day = days_since_og()

    text = (
        f"📅 *Day {day} — 보상 없이*\n"
        f"━━━━━━━━━━━━━━━━━\n\n"
        f"🕐 2024년 1월 5일, bags.fm이 OG 멤버를 모집했습니다.\n"
        f"오늘로 **{day}일째**, 체계적인 보상은 없습니다.\n\n"
        f"*현재 현황:*\n"
        f"✍️ 서명자: **{st['count']}명**\n"
        f"💰 총 투자: **{st['total_sol']:.1f} SOL**\n"
        f"📊 3 SOL 구매자: {st['sol3']}명 · 1.5 SOL: {st['sol15']}명\n\n"
        f"아직 서명하지 않은 OG 멤버라면:\n"
        f"👉 @OGLedgerChat 에서 `/verify [지갑]` 입력\n\n"
        f"#BagsOG #OGLedger #Day{day}"
    )

    # 영어 병행
    text_en = (
        f"\n\n🇺🇸 *Day {day} without compensation.*\n"
        f"bags.fm raised $4M+. OG investors got $0.\n"
        f"Join us → @OGLedgerChat"
    )

    kb = InlineKeyboardMarkup([[
        InlineKeyboardButton("✍️ 서명하기 / Sign", url="https://t.me/OGLedgerChat"),
        InlineKeyboardButton("🌐 OG LEDGER", url="https://og-ledger.xyz")
    ]])

    await post_to_channel(bot, text + text_en, kb=kb)


async def welcome_new_signer(bot: Bot, signer: dict, rank: int):
    """새 서명자 환영 메시지 — 채널 + 그룹."""
    name     = signer.get("display_name") or short(signer["wallet"])
    sol      = signer["sol"]
    st       = signer_stats()
    is_mile  = rank in MILESTONES

    # 채널 공지
    channel_text = (
        f"✍️ *새 서명자 — #{rank}번째*\n\n"
        f"**{name}** 님이 OG 청원에 서명했습니다.\n"
        f"투자: `{sol:.1f} SOL` · 지갑: `{short(signer['wallet'])}`\n\n"
        f"현재 총 서명: **{st['count']}명** / **{st['total_sol']:.1f} SOL**\n\n"
        f"_Welcome {name}! Another OG voice added. {st['count']} strong._\n\n"
        f"#BagsOG #OGLedger"
    )

    if is_mile:
        channel_text = (
            f"🔥 *마일스톤 달성 — {rank}번째 서명!*\n\n"
            + channel_text.split("\n\n", 1)[1]
        )

    kb = InlineKeyboardMarkup([[
        InlineKeyboardButton("나도 서명하기", url="https://t.me/OGLedgerChat")
    ]])
    await post_to_channel(bot, channel_text, kb=kb)

    # 그룹 환영
    try:
        group_text = (
            f"🎉 `{short(signer['wallet'])}` 님 OG 인증 완료!\n"
            f"**#{rank}번째 서명자** ({sol:.1f} SOL)\n\n"
            f"총 서명: **{st['count']}명** / **{st['total_sol']:.1f} SOL** 💪"
        )
        await bot.send_message(GROUP_ID, group_text, parse_mode="Markdown")
    except Exception as e:
        log.warning(f"그룹 환영 메시지 실패: {e}")


async def bags_twitter_monitor(bot: Bot):
    """bags.fm 공식 트위터 새 트윗 모니터링 (Twitter API v2)."""
    if not TWITTER_BEARER:
        return

    url = f"https://api.twitter.com/2/users/{BAGS_TWITTER_ID}/tweets"
    headers = {"Authorization": f"Bearer {TWITTER_BEARER}"}
    params = {
        "max_results": 5,
        "tweet.fields": "created_at,text",
        **({"since_id": store["last_tweet_id"]} if store["last_tweet_id"] else {})
    }

    try:
        async with aiohttp.ClientSession() as sess:
            async with sess.get(url, headers=headers, params=params,
                                timeout=aiohttp.ClientTimeout(total=10)) as r:
                if r.status != 200:
                    return
                data = await r.json()

        tweets = data.get("data", [])
        if not tweets:
            return

        # 최신 트윗 ID 저장
        store["last_tweet_id"] = tweets[0]["id"]

        for tweet in reversed(tweets):  # 오래된 것부터
            text     = tweet["text"]
            tweet_id = tweet["id"]
            created  = tweet.get("created_at", "")

            # OG 관련 키워드 체크
            og_keywords = ["og", "reward", "보상", "early", "supporter", "airdrop", "token"]
            is_og_related = any(kw in text.lower() for kw in og_keywords)

            flag = "🚨 *OG 관련 트윗 감지!*\n\n" if is_og_related else "📡 *@BagsApp 새 트윗*\n\n"

            channel_text = (
                f"{flag}"
                f"_{text[:280]}_\n\n"
                f"🔗 [트윗 보기](https://twitter.com/BagsApp/status/{tweet_id})\n"
                f"🕐 {created[:10] if created else '방금'}\n\n"
                f"{'⚠️ OG 보상 관련 내용인지 확인하세요!' if is_og_related else ''}"
                f"\n#BagsOG #OGLedger"
            )

            kb = InlineKeyboardMarkup([[
                InlineKeyboardButton("트윗 확인", url=f"https://twitter.com/BagsApp/status/{tweet_id}"),
                InlineKeyboardButton("💬 토론", url=f"https://t.me/OGLedgerChat")
            ]])
            await post_to_channel(bot, channel_text, kb=kb)
            await asyncio.sleep(1)

    except Exception as e:
        log.warning(f"Twitter 모니터링 오류: {e}")


# ─── BOT COMMANDS ────────────────────────────────────────────────

async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    st = signer_stats()

    text = (
        f"⚖️ *OG LEDGER*\n"
        f"Accountability Protocol for bags.fm OG Members\n\n"
        f"📅 OG 모집: 2024.01.05\n"
        f"⏳ 경과: *{days_since_og()}일* 보상 없이\n"
        f"✍️ 현재 서명: *{st['count']}명* / *{st['total_sol']:.1f} SOL*\n\n"
        f"*명령어:*\n"
        f"`/verify [지갑주소]` — OG 자격 인증\n"
        f"`/sign` — 청원 서명 (인증 후)\n"
        f"`/status` — 서명 현황\n"
        f"`/demand` — 공식 요구문\n"
        f"`/list` — 서명자 목록\n\n"
        f"📢 @OGLedgerChannel"
    )

    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("✍️ 바로 서명하기", callback_data="sign_flow")],
        [
            InlineKeyboardButton("📢 채널", url="https://t.me/OGLedgerChannel"),
            InlineKeyboardButton("🌐 웹앱", url="https://og-ledger.xyz")
        ]
    ])
    await update.message.reply_text(text, parse_mode="Markdown", reply_markup=kb)


async def cmd_verify(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user

    if not ctx.args:
        await update.message.reply_text(
            "📍 *사용법:*\n`/verify [솔라나 지갑 주소]`\n\n"
            "*예시:*\n`/verify 3nCpr7q...AbCd`\n\n"
            "_Usage: /verify [Solana wallet address]_",
            parse_mode="Markdown"
        )
        return

    wallet = ctx.args[0].strip()

    if not (32 <= len(wallet) <= 50):
        await update.message.reply_text("❌ 유효하지 않은 지갑 주소입니다. _(Invalid wallet address)_", parse_mode="Markdown")
        return

    # 이미 서명한 경우
    if wallet in store["signers"]:
        v = store["signers"][wallet]
        await update.message.reply_text(
            f"✅ *이미 인증된 OG 멤버입니다*\n"
            f"_Already verified OG member_\n\n"
            f"지갑: `{short(wallet)}`\n"
            f"투자: `{v['sol']:.1f} SOL`\n"
            f"서명일: {v['signed_at'][:10]}",
            parse_mode="Markdown"
        )
        return

    msg = await update.message.reply_text(
        "🔍 온체인 인증 중...\n_Verifying on-chain..._",
        parse_mode="Markdown"
    )

    try:
        is_og, sol = await verify_og(wallet)

        if is_og:
            store["pending"][user.id] = {"wallet": wallet, "sol": sol}
            kb = InlineKeyboardMarkup([[
                InlineKeyboardButton("✍️ 청원 서명 / Sign Petition", callback_data=f"do_sign:{wallet}:{sol}")
            ]])
            await msg.edit_text(
                f"✅ *OG 멤버 인증 완료!*\n"
                f"_OG Member Verified!_\n\n"
                f"지갑: `{short(wallet)}`\n"
                f"투자: `{sol:.1f} SOL` (2024년 1~3월)\n\n"
                f"아래 버튼으로 청원에 서명하세요:\n"
                f"_Tap below to sign the petition:_",
                parse_mode="Markdown",
                reply_markup=kb
            )
        else:
            await msg.edit_text(
                f"❌ *OG 자격 미확인*\n"
                f"_OG status not found_\n\n"
                f"`{short(wallet)}`에서\n"
                f"bags 공식 지갑으로의 1.5/3 SOL 송금 기록이\n"
                f"2024년 1~3월 기간에 없습니다.\n\n"
                f"_No 1.5/3 SOL transfer found from this wallet_\n"
                f"_to bags official wallet in Jan~Mar 2024._\n\n"
                f"💡 지갑 주소를 다시 확인해주세요.",
                parse_mode="Markdown"
            )
    except RuntimeError as e:
        await msg.edit_text(
            f"⚠️ *RPC 오류*\n`{e}`\n\n잠시 후 다시 시도해주세요.",
            parse_mode="Markdown"
        )


async def cmd_sign(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user

    # 이미 서명 확인
    existing = next(
        (v for v in store["signers"].values() if v.get("tg_id") == user.id),
        None
    )
    if existing:
        await update.message.reply_text(
            f"✅ *이미 서명 완료!*\n_Already signed!_\n\n"
            f"지갑: `{short(existing['wallet'])}`\n"
            f"서명일: {existing['signed_at'][:10]}",
            parse_mode="Markdown"
        )
        return

    pending = store["pending"].get(user.id)
    if not pending:
        await update.message.reply_text(
            "⚠️ 먼저 지갑 인증이 필요합니다.\n"
            "_Please verify your wallet first:_\n\n"
            "`/verify [지갑주소]`",
            parse_mode="Markdown"
        )
        return

    await _do_sign(update, ctx, pending["wallet"], pending["sol"], user)


async def _do_sign(update, ctx, wallet, sol, user):
    """실제 서명 처리 (명령어 + 콜백 공용)."""
    display = f"@{user.username}" if user.username else f"OG #{len(store['signers'])+1:04d}"
    rank    = len(store["signers"]) + 1

    signer = {
        "tg_id":        user.id,
        "tg_name":      user.full_name,
        "username":     user.username or "",
        "wallet":       wallet,
        "sol":          sol,
        "display_name": display,
        "rank":         rank,
        "signed_at":    datetime.now(timezone.utc).isoformat()
    }

    store["signers"][wallet] = signer
    store["pending"].pop(user.id, None)

    st = signer_stats()

    # 사용자에게 확인
    text = (
        f"✍️ *서명 완료! Signed!*\n\n"
        f"지갑: `{short(wallet)}`\n"
        f"투자: `{sol:.1f} SOL`\n"
        f"서명 순번: *#{rank}*\n\n"
        f"━━━━━━━━━━━━\n"
        f"총 서명: *{st['count']}명*\n"
        f"총 투자: *{st['total_sol']:.1f} SOL*\n"
        f"보상 없는 날: *{days_since_og()}일*\n\n"
        f"📢 채널 공유로 더 많은 OG를 모아주세요!\n"
        f"_Share to gather more OG members!_"
    )

    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("📢 채널 공유 / Share", url="https://t.me/OGLedgerChannel")],
        [InlineKeyboardButton("📊 현황 / Status", callback_data="show_status")]
    ])

    if update.callback_query:
        await update.callback_query.message.edit_text(text, parse_mode="Markdown", reply_markup=kb)
    else:
        await update.message.reply_text(text, parse_mode="Markdown", reply_markup=kb)

    # 채널 자동 포스팅 (비동기 백그라운드)
    bot = ctx.bot
    asyncio.create_task(welcome_new_signer(bot, signer, rank))


async def cmd_status(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    st  = signer_stats()
    day = days_since_og()

    text = (
        f"📊 *OG LEDGER 현황 / Status*\n\n"
        f"✍️ 총 서명자: *{st['count']}명*\n"
        f"💰 총 투자 SOL: *{st['total_sol']:.1f} SOL*\n"
        f"   ├ 3 SOL 구매자: {st['sol3']}명\n"
        f"   └ 1.5 SOL 구매자: {st['sol15']}명\n\n"
        f"📅 OG 모집: 2024.01.05\n"
        f"⏳ 보상 없는 날: *{day}일*\n\n"
        f"bags.fm 공식 지갑:\n"
        f"`{BAGS_WALLET[:20]}...`\n\n"
        f"_Total signers: {st['count']} · {st['total_sol']:.1f} SOL invested_\n"
        f"_{day} days without compensation_"
    )

    kb = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("✍️ 서명하기", callback_data="sign_flow"),
            InlineKeyboardButton("📋 목록", callback_data="show_list")
        ],
        [InlineKeyboardButton("🌐 웹앱 전체 데이터", url="https://og-ledger.xyz")]
    ])
    await update.message.reply_text(text, parse_mode="Markdown", reply_markup=kb)


async def cmd_demand(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    st  = signer_stats()
    day = days_since_og()

    ko = (
        f"━━━━━━━━━━━━━━━━━\n"
        f"📣 OG 멤버 공동 청원서\n"
        f"━━━━━━━━━━━━━━━━━\n\n"
        f"우리 bags.fm OG 멤버 {st['count']}명은\n"
        f"2024년 초 직접 SOL을 투자한 초기 지지자입니다.\n\n"
        f"오늘로 {day}일째, 체계적 보상은 없습니다.\n"
        f"Hackathon $4M+ 펀딩 달성. OG 보상 $0.\n\n"
        f"우리의 요구:\n"
        f"1. OG 보상 로드맵 즉각 공개\n"
        f"2. 플랫폼 수익 OG 배분 비율 명시\n"
        f"3. OG 멤버 대상 공개 서한\n"
        f"4. 소급 보상 방안 검토 및 공표\n"
    )

    en = (
        f"\n---\n"
        f"📣 OG Member Collective Petition\n\n"
        f"{st['count']} OG members. {st['total_sol']:.1f} SOL invested.\n"
        f"{day} days. Zero compensation.\n\n"
        f"We demand:\n"
        f"1. Immediate OG reward roadmap\n"
        f"2. Clear revenue share terms for OGs\n"
        f"3. Official open letter to OG members\n"
        f"4. Retroactive compensation review\n\n"
        f"━━━━━━━━━━━━━━━━━\n"
        f"✍️ {st['count']} signed · {st['total_sol']:.1f} SOL · {day} days\n"
        f"#BagsOG #OGLedger #BagsFM"
    )

    kb = InlineKeyboardMarkup([[
        InlineKeyboardButton("📢 공유 / Share", switch_inline_query="OG LEDGER — bags.fm에 보상을 요구합니다 #BagsOG")
    ]])
    await update.message.reply_text(ko + en, reply_markup=kb)


async def cmd_list(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    signers = store["signers"]
    if not signers:
        await update.message.reply_text(
            "아직 서명자가 없습니다.\n"
            "`/verify [지갑]` → `/sign` 으로 첫 번째 서명자가 되어주세요!\n\n"
            "_No signers yet. Be the first!_",
            parse_mode="Markdown"
        )
        return

    sorted_s = sorted(signers.values(), key=lambda x: x["sol"], reverse=True)
    lines = []
    for v in sorted_s[:30]:
        name = v.get("display_name") or short(v["wallet"])
        lines.append(f"#{v['rank']:03d} {name} — {v['sol']:.1f} SOL")

    text = (
        f"✍️ *서명자 목록 / Signers ({len(signers)}명)*\n\n"
        + "\n".join(lines)
    )
    if len(signers) > 30:
        text += f"\n\n_...and {len(signers)-30} more on og-ledger.xyz_"

    await update.message.reply_text(text, parse_mode="Markdown")


async def cmd_announce(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """관리자 전용: 채널에 커스텀 메시지 발송."""
    # 관리자 권한 체크 (봇 오너 tg_id 환경변수로 설정 권장)
    admin_id = int(os.getenv("ADMIN_TG_ID", "0"))
    if update.effective_user.id != admin_id and admin_id != 0:
        await update.message.reply_text("⛔ 관리자 전용 명령어입니다.")
        return

    if not ctx.args:
        await update.message.reply_text("사용법: `/announce 메시지 내용`", parse_mode="Markdown")
        return

    msg = " ".join(ctx.args)
    await post_to_channel(ctx.bot, f"📢 *공지 / Announcement*\n\n{msg}\n\n#BagsOG")
    await update.message.reply_text("✅ 채널에 발송 완료.")


# ─── CALLBACK QUERY ──────────────────────────────────────────────

async def on_callback(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q    = update.callback_query
    data = q.data
    user = update.effective_user
    await q.answer()

    if data == "show_status":
        await cmd_status(update, ctx)

    elif data == "show_list":
        await cmd_list(update, ctx)

    elif data == "sign_flow":
        await q.message.reply_text(
            "먼저 지갑 인증:\n_First, verify your wallet:_\n\n"
            "`/verify [솔라나 지갑 주소]`",
            parse_mode="Markdown"
        )

    elif data.startswith("do_sign:"):
        parts  = data.split(":")
        wallet = parts[1]
        sol    = float(parts[2])

        if wallet in store["signers"]:
            await q.message.edit_text("✅ 이미 서명 완료된 지갑입니다.", parse_mode="Markdown")
            return

        await _do_sign(update, ctx, wallet, sol, user)


# ─── NEW MEMBER HANDLER ──────────────────────────────────────────

async def on_new_member(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """그룹에 새 멤버 입장 시 안내."""
    for member in (update.message.new_chat_members or []):
        if member.is_bot:
            continue
        text = (
            f"👋 환영합니다, {member.first_name}!\n"
            f"_Welcome to OG LEDGER Chat!_\n\n"
            f"OG 멤버라면:\n"
            f"`/verify [지갑주소]` → `/sign` 순서로 서명해주세요.\n\n"
            f"_If you're an OG member:_\n"
            f"_/verify [wallet] → /sign_\n\n"
            f"📢 채널: @OGLedgerChannel\n"
            f"🌐 웹앱: og-ledger.xyz"
        )
        await update.message.reply_text(text, parse_mode="Markdown")


# ─── SCHEDULER SETUP ─────────────────────────────────────────────

def setup_scheduler(bot) -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler(timezone="Asia/Seoul")

    # 매일 00:00 KST — 경과일 카운터
    scheduler.add_job(
        daily_counter_post,
        CronTrigger(hour=0, minute=0),
        args=[bot],
        id="daily_counter",
        name="Daily Counter Post"
    )

    # 매 30분 — 트위터 모니터링
    scheduler.add_job(
        bags_twitter_monitor,
        "interval",
        minutes=30,
        args=[bot],
        id="twitter_monitor",
        name="Twitter Monitor"
    )

    log.info("스케줄러 설정 완료 (매일 00:00 카운터 · 30분 트위터 체크)")
    return scheduler


# ─── MAIN ────────────────────────────────────────────────────────

async def post_init(app: Application):
    """이벤트 루프 시작 후 스케줄러 실행."""
    scheduler = setup_scheduler(app.bot)
    scheduler.start()
    app.bot_data["scheduler"] = scheduler
    log.info("스케줄러 시작 완료")


def main():
    log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    log.info("  OG LEDGER Bot v2 시작")
    log.info(f"  채널: {CHANNEL_ID}")
    log.info(f"  그룹: {GROUP_ID}")
    log.info(f"  BAGS 지갑: {BAGS_WALLET[:20]}...")
    log.info(f"  RPC: {SOLANA_RPC}")
    log.info(f"  Twitter 모니터링: {'ON' if TWITTER_BEARER else 'OFF'}")
    log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

    app = (
        Application.builder()
        .token(BOT_TOKEN)
        .post_init(post_init)
        .build()
    )

    # 명령어
    app.add_handler(CommandHandler("start",    cmd_start))
    app.add_handler(CommandHandler("verify",   cmd_verify))
    app.add_handler(CommandHandler("sign",     cmd_sign))
    app.add_handler(CommandHandler("status",   cmd_status))
    app.add_handler(CommandHandler("demand",   cmd_demand))
    app.add_handler(CommandHandler("list",     cmd_list))
    app.add_handler(CommandHandler("announce", cmd_announce))

    # 콜백
    app.add_handler(CallbackQueryHandler(on_callback))

    # 새 멤버
    app.add_handler(MessageHandler(filters.StatusUpdate.NEW_CHAT_MEMBERS, on_new_member))

    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
