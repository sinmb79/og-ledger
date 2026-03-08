"""
OG LEDGER — Community Rewards Infrastructure Bot v2
채널(공지) + 그룹(토론/인증) 통합 운영

구조:
  📢 채널 @OGLedgerChannel  — 자동 공지 전용
  💬 그룹 @OGLedgerChat     — 토론 + 봇 인증/등록
  🤖 봇   @OGLedgerBot      — 그룹 내 명령 처리

자동 포스팅:
  - 매일 00:00 경과일 카운터
  - 새 멤버 환영 (즉시)
  - N번째 멤버 마일스톤
  - bags.fm 트위터 모니터링 알림

설치:
  pip install python-telegram-bot aiohttp apscheduler

환경변수 (.env 파일 참고):
  BOT_TOKEN          : Telegram Bot Token
  CHANNEL_ID         : Telegram Channel ID
  GROUP_ID           : Telegram Group ID
  BAGS_WALLET        : bags.fm 공식 지갑 주소
  SOLANA_RPC         : Solana RPC URL
  TWITTER_BEARER     : Twitter/X API Bearer Token (모니터링용, 선택)
"""

# pyright: reportGeneralTypeIssues=false, reportOptionalMemberAccess=false, reportMissingTypeArgument=false, reportArgumentType=false, reportAttributeAccessIssue=false, reportOperatorIssue=false, reportOptionalSubscript=false, reportIndexIssue=false

import os, json, asyncio, aiohttp, logging, hashlib
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Optional
from telegram import (
    Update, InlineKeyboardButton, InlineKeyboardMarkup, Bot
)
from telegram.ext import (
    Application, CommandHandler, ContextTypes,
    CallbackQueryHandler, MessageHandler, filters,
    ChatMemberHandler, ConversationHandler
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
BACKEND_URL    = os.getenv("BACKEND_URL",    "http://localhost:3001")
X_SOURCE       = os.getenv("X_SOURCE", "auto").strip().lower()
RSS_FEEDS      = [u.strip() for u in os.getenv("RSS_FEEDS", "").split(",") if u.strip()]

BAGS_TWITTER_ID = "1609677817947537408"   # @BagsApp Twitter/X user ID
OG_START        = datetime(2024, 1, 5, tzinfo=timezone.utc)
OG_AMOUNTS_LAM  = [1_500_000_000, 3_000_000_000]
TOLERANCE_LAM   = 2_000_000

# 마일스톤 멤버 수 (채널에 자동 공지)
MILESTONES = {10, 25, 50, 100, 200, 500, 1000}

# ─── STORE (프로덕션에서는 SQLite / Redis 교체) ──────────────────
store = {
    "signers":        {},   # wallet → signer_info
    "pending":        {},   # tg_id  → { wallet, sol }
    "last_tweet_id":  None, # 마지막 체크한 트윗 ID
    "last_milestone": 0,    # 마지막 알림 마일스톤
    "launch_data":    {},   # tg_id  → { name, symbol } (launch conversation state)
    "rss_state":      {},   # feed_url -> { etag, last_modified, last_entry_id }
}

# ─── UTILS ───────────────────────────────────────────────────────
def days_since_og() -> int:
    return (datetime.now(timezone.utc) - OG_START).days

def short(addr: str) -> str:
    return f"{addr[:6]}…{addr[-4:]}"

def sol_fmt(lamports: float) -> str:
    return f"{lamports:.1f} SOL"

async def api_get(path: str) -> dict:
    """Backend API GET helper. Returns {"success": bool, "data": ...} or {"success": False, "message": str(error)}"""
    try:
        async with aiohttp.ClientSession() as sess:
            async with sess.get(
                f"{BACKEND_URL}{path}",
                timeout=aiohttp.ClientTimeout(total=10)
            ) as r:
                return await r.json()
    except Exception as e:
        log.warning(f"api_get({path}) error: {e}")
        return {"success": False, "message": str(e)}

async def api_post(path: str, body: dict) -> dict:
    """Backend API POST helper. Returns {"success": bool, "data": ...} or {"success": False, "message": str(error)}"""
    try:
        async with aiohttp.ClientSession() as sess:
            async with sess.post(
                f"{BACKEND_URL}{path}",
                json=body,
                timeout=aiohttp.ClientTimeout(total=15)
            ) as r:
                return await r.json()
    except Exception as e:
        log.warning(f"api_post({path}) error: {e}")
        return {"success": False, "message": str(e)}

async def member_stats() -> dict:
    """Get member stats from backend API, fallback to in-memory store."""
    # Try backend API first
    result = await api_get("/api/og/stats")
    if result.get("success"):
        data = result.get("data", {})
        return {
            "count":     data.get("count", 0),
            "total_sol": data.get("totalSol", 0.0),
            "sol3":      data.get("sol3Count", 0),
            "sol15":     data.get("sol15Count", 0),
        }
    
    # Fallback to in-memory store
    log.info("member_stats() falling back to in-memory store")
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
    """온체인에서 OG 자격 확인 (레거시 폴백용). Primary path should use backend API."""
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
    st  = await member_stats()
    day = days_since_og()

    text = (
        f"📅 *Day {day} — OG Community*\n"
        f"━━━━━━━━━━━━━━━━━\n\n"
        f"🕐 2024년 1월 5일, bags.fm이 OG 멤버를 모집했습니다.\n"
        f"오늘로 **{day}일째**, 함께 리워드 생태계를 만들어가고 있습니다.\n\n"
        f"*현재 현황:*\n"
        f"👥 멤버: **{st['count']}명**\n"
        f"💰 총 참여: **{st['total_sol']:.1f} SOL**\n"
        f"📊 3 SOL 구매자: {st['sol3']}명 · 1.5 SOL: {st['sol15']}명\n\n"
        f"아직 등록하지 않은 OG 멤버라면:\n"
        f"👉 @OGLedgerChat 에서 `/verify [지갑]` 입력\n\n"
        f"#BagsOG #OGLedger #Day{day}"
    )

    # 영어 병행
    text_en = (
        f"\n\n🇺🇸 *Day {day} building together.*\n"
        f"Join the OG community and start earning.\n"
        f"Join us → @OGLedgerChat"
    )

    kb = InlineKeyboardMarkup([[
        InlineKeyboardButton("🤝 참여하기 / Join", url="https://t.me/OGLedgerChat"),
        InlineKeyboardButton("🌐 OG LEDGER", url="https://og-ledger.xyz")
    ]])

    await post_to_channel(bot, text + text_en, kb=kb)


async def welcome_new_member(bot: Bot, signer: dict, rank: int):
    """새 멤버 환영 메시지 — 채널 + 그룹."""
    name     = signer.get("display_name") or short(signer["wallet"])
    sol      = signer["sol"]
    st       = await member_stats()
    is_mile  = rank in MILESTONES

    # 채널 공지
    channel_text = (
        f"🎉 *새 멤버 — #{rank}번째*\n\n"
        f"**{name}** 님이 OG 커뮤니티에 등록했습니다.\n"
        f"투자: `{sol:.1f} SOL` · 지갑: `{short(signer['wallet'])}`\n\n"
        f"현재 총 멤버: **{st['count']}명** / **{st['total_sol']:.1f} SOL**\n\n"
        f"_Welcome {name}! Another OG member joined. {st['count']} strong._\n\n"
        f"#BagsOG #OGLedger"
    )

    if is_mile:
        channel_text = (
            f"🔥 *마일스톤 달성 — {rank}번째 멤버!*\n\n"
            + channel_text.split("\n\n", 1)[1]
        )

    kb = InlineKeyboardMarkup([[
        InlineKeyboardButton("나도 참여하기", url="https://t.me/OGLedgerChat")
    ]])
    await post_to_channel(bot, channel_text, kb=kb)

    # 그룹 환영
    try:
        group_text = (
            f"🎉 `{short(signer['wallet'])}` 님 OG 인증 완료!\n"
            f"**#{rank}번째 멤버** ({sol:.1f} SOL)\n\n"
            f"총 멤버: **{st['count']}명** / **{st['total_sol']:.1f} SOL** 💪"
        )
        await bot.send_message(GROUP_ID, group_text, parse_mode="Markdown")
    except Exception as e:
        log.warning(f"그룹 환영 메시지 실패: {e}")


def _rss_child_text(node: ET.Element, names: list[str]) -> str:
    for n in names:
        found = node.find(n)
        if found is not None and found.text:
            return found.text.strip()
    return ""


def _parse_rss_items(xml_text: str) -> list[dict]:
    items: list[dict] = []
    root = ET.fromstring(xml_text)

    channel = root.find("channel")
    if channel is not None:
        nodes = channel.findall("item")
        for item in nodes:
            title = _rss_child_text(item, ["title"])
            link = _rss_child_text(item, ["link"])
            guid = _rss_child_text(item, ["guid"])
            pub_date = _rss_child_text(item, ["pubDate"])
            desc = _rss_child_text(item, ["description"])
            entry_id = guid or link or hashlib.sha256(f"{title}|{pub_date}".encode("utf-8")).hexdigest()
            items.append({
                "id": entry_id,
                "title": title,
                "link": link,
                "published": pub_date,
                "summary": desc,
            })
        return items

    atom_ns = {"a": "http://www.w3.org/2005/Atom"}
    for entry in root.findall("a:entry", atom_ns):
        title = _rss_child_text(entry, ["{http://www.w3.org/2005/Atom}title"])
        link_node = entry.find("a:link", atom_ns)
        link = link_node.get("href", "") if link_node is not None else ""
        entry_id = _rss_child_text(entry, ["{http://www.w3.org/2005/Atom}id"]) or link
        published = _rss_child_text(entry, ["{http://www.w3.org/2005/Atom}published", "{http://www.w3.org/2005/Atom}updated"])
        summary = _rss_child_text(entry, ["{http://www.w3.org/2005/Atom}summary", "{http://www.w3.org/2005/Atom}content"])
        if not entry_id:
            entry_id = hashlib.sha256(f"{title}|{published}".encode("utf-8")).hexdigest()
        items.append({
            "id": entry_id,
            "title": title,
            "link": link,
            "published": published,
            "summary": summary,
        })
    return items


async def _rss_monitor(bot: Bot):
    if not RSS_FEEDS:
        return

    for feed_url in RSS_FEEDS:
        state = store["rss_state"].get(feed_url, {})
        headers: dict[str, str] = {}
        if state.get("etag"):
            headers["If-None-Match"] = state["etag"]
        if state.get("last_modified"):
            headers["If-Modified-Since"] = state["last_modified"]

        try:
            async with aiohttp.ClientSession() as sess:
                async with sess.get(feed_url, headers=headers, timeout=aiohttp.ClientTimeout(total=12)) as r:
                    if r.status == 304:
                        continue
                    if r.status != 200:
                        log.warning(f"RSS 모니터링 HTTP 오류 ({r.status}): {feed_url}")
                        continue

                    raw = await r.text()
                    etag = r.headers.get("ETag", "")
                    last_modified = r.headers.get("Last-Modified", "")

            items = _parse_rss_items(raw)
            if not items:
                continue

            latest_id = items[0]["id"]
            last_id = state.get("last_entry_id")

            # 초기 실행 시 기존 글 대량 전송 방지
            if not last_id:
                store["rss_state"][feed_url] = {
                    "etag": etag,
                    "last_modified": last_modified,
                    "last_entry_id": latest_id,
                }
                continue

            new_items: list[dict] = []
            for entry in items:
                if entry["id"] == last_id:
                    break
                new_items.append(entry)

            if not new_items:
                store["rss_state"][feed_url] = {
                    "etag": etag,
                    "last_modified": last_modified,
                    "last_entry_id": latest_id,
                }
                continue

            for entry in reversed(new_items[:5]):
                title = entry["title"][:160] if entry["title"] else "(제목 없음)"
                summary = (entry["summary"] or "").replace("\n", " ").strip()
                if len(summary) > 220:
                    summary = summary[:220] + "..."

                text = (
                    "📡 *공지 피드 업데이트*\n\n"
                    f"*{title}*\n"
                    f"{summary}\n\n"
                    f"🔗 {entry['link'] or feed_url}\n"
                    f"🕐 {entry['published'] or '방금'}\n\n"
                    "#BagsOG #OGLedger"
                )

                kb = InlineKeyboardMarkup([[
                    InlineKeyboardButton("원문 보기", url=entry["link"] or feed_url),
                    InlineKeyboardButton("💬 토론", url="https://t.me/OGLedgerChat")
                ]])
                await post_to_channel(bot, text, kb=kb)
                await asyncio.sleep(1)

            store["rss_state"][feed_url] = {
                "etag": etag,
                "last_modified": last_modified,
                "last_entry_id": latest_id,
            }

        except Exception as e:
            log.warning(f"RSS 모니터링 오류 ({feed_url}): {e}")


async def bags_twitter_monitor(bot: Bot):
    """공식 X API 또는 RSS 피드로 공지 모니터링."""
    use_api = TWITTER_BEARER and (X_SOURCE in ("auto", "api"))
    use_rss = RSS_FEEDS and (X_SOURCE in ("auto", "rss"))

    if use_api:
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
        return

    if use_rss:
        await _rss_monitor(bot)
        return

    if X_SOURCE == "api" and not TWITTER_BEARER:
        log.info("X_SOURCE=api 이지만 TWITTER_BEARER가 없어 모니터링을 건너뜁니다.")
    elif X_SOURCE == "rss" and not RSS_FEEDS:
        log.info("X_SOURCE=rss 이지만 RSS_FEEDS가 비어 있어 모니터링을 건너뜁니다.")
    elif X_SOURCE == "disabled":
        return
    else:
        return


# ─── BOT COMMANDS ────────────────────────────────────────────────

async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    st = await member_stats()

    text = (
        f"🌟 *OG LEDGER*\n"
        f"Community Rewards for bags.fm OG Members\n\n"
        f"📅 OG 모집: 2024.01.05\n"
        f"⏳ 경과: *{days_since_og()}일* 커뮤니티 성장 중\n"
        f"👥 현재 멤버: *{st['count']}명* / *{st['total_sol']:.1f} SOL*\n\n"
        f"*명령어:*\n"
        f"`/verify [지갑주소]` — OG 자격 인증\n"
        f"`/register` — 커뮤니티 등록 / Register\n"
        f"`/sign` — 커뮤니티 등록 / Register\n"
        f"`/launch` — 토큰 런칭 / Launch token\n"
        f"`/claim` — 수수료 청구 / Claim fees\n"
        f"`/portfolio` — 포트폴리오 / Portfolio\n"
        f"`/status` — 커뮤니티 현황\n"
        f"`/list` — 멤버 목록\n\n"
        f"📢 @OGLedgerChannel"
    )

    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("🤝 바로 참여하기", callback_data="sign_flow")],
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

    # 이미 등록한 경우
    if wallet in store["signers"]:
        v = store["signers"][wallet]
        await update.message.reply_text(
            f"✅ *이미 인증된 OG 멤버입니다*\n"
            f"_Already verified OG member_\n\n"
            f"지갑: `{short(wallet)}`\n"
            f"투자: `{v['sol']:.1f} SOL`\n"
            f"등록일: {v['signed_at'][:10]}",
            parse_mode="Markdown"
        )
        return

    msg = await update.message.reply_text(
        "🔍 인증 중...\n_Verifying via backend API..._",
        parse_mode="Markdown"
    )

    try:
        # Call backend API for verification
        result = await api_get(f"/api/og/verify/{wallet}")
        
        if not result.get("success"):
            await msg.edit_text(
                f"⚠️ *API 오류*\n`{result.get('message', 'Unknown error')}`\n\n잠시 후 다시 시도해주세요.",
                parse_mode="Markdown"
            )
            return
        
        data = result.get("data", {})
        is_verified = data.get("verified", False)
        
        if is_verified:
            sol = data.get("solAmount", 0.0)
            store["pending"][user.id] = {"wallet": wallet, "sol": sol}
            kb = InlineKeyboardMarkup([[
                InlineKeyboardButton("🤝 커뮤니티 등록 / Register", callback_data=f"do_register:{wallet}:{sol}")
            ]])
            await msg.edit_text(
                f"✅ *OG 멤버 인증 완료!*\n"
                f"_OG Member Verified!_\n\n"
                f"지갑: `{short(wallet)}`\n"
                f"투자: `{sol:.1f} SOL` (2024년 1~3월)\n\n"
                f"아래 버튼으로 커뮤니티에 등록하세요:\n"
                f"_Tap below to register as OG member:_",
                parse_mode="Markdown",
                reply_markup=kb
            )
        else:
            reason = data.get("reason", "OG status not found")
            await msg.edit_text(
                f"❌ *OG 자격 미확인*\n"
                f"_OG status not found_\n\n"
                f"`{short(wallet)}`\n\n"
                f"사유: {reason}\n"
                f"_Reason: {reason}_\n\n"
                f"💡 지갑 주소를 다시 확인해주세요.",
                parse_mode="Markdown"
            )
    except Exception as e:
        log.error(f"cmd_verify error: {e}")
        await msg.edit_text(
            f"⚠️ *오류*\n`{e}`\n\n잠시 후 다시 시도해주세요.",
            parse_mode="Markdown"
        )


async def cmd_register(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user

    # 이미 등록 확인
    existing = next(
        (v for v in store["signers"].values() if v.get("tg_id") == user.id),
        None
    )
    if existing:
        await update.message.reply_text(
            f"✅ *이미 등록 완료!*\n_Already registered!_\n\n"
            f"지갑: `{short(existing['wallet'])}`\n"
            f"등록일: {existing['signed_at'][:10]}",
            parse_mode="Markdown"
        )
        return

    pending = store["pending"].get(user.id)
    if not pending:
        await update.message.reply_text(
            "⚠️ 먼저 지갑 인증이 필요합니다.\n"
            "_Please verify your wallet first:_\n\n"
            "`/verify [지갑주소]` 후 `/register` 또는 `/sign`",
            parse_mode="Markdown"
        )
        return

    await _do_register(update, ctx, pending["wallet"], pending["sol"], user)


async def _do_register(update, ctx, wallet, sol, user):
    """실제 등록 처리 (명령어 + 콜백 공용)."""
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

    st = await member_stats()

    # 사용자에게 확인
    text = (
        f"✅ *등록 완료! Registered!*\n\n"
        f"지갑: `{short(wallet)}`\n"
        f"투자: `{sol:.1f} SOL`\n"
        f"등록 순번: *#{rank}*\n\n"
        f"━━━━━━━━━━━━\n"
        f"총 멤버: *{st['count']}명*\n"
        f"총 투자: *{st['total_sol']:.1f} SOL*\n"
        f"커뮤니티 활동일: *{days_since_og()}일*\n\n"
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
    asyncio.create_task(welcome_new_member(bot, signer, rank))


async def cmd_status(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    st  = await member_stats()
    day = days_since_og()

    text = (
        f"📊 *OG LEDGER 현황 / Status*\n\n"
        f"👥 총 멤버: *{st['count']}명*\n"
        f"💰 총 투자 SOL: *{st['total_sol']:.1f} SOL*\n"
        f"   ├ 3 SOL 구매자: {st['sol3']}명\n"
        f"   └ 1.5 SOL 구매자: {st['sol15']}명\n\n"
        f"📅 OG 모집: 2024.01.05\n"
        f"⏳ 커뮤니티 활동일: *{day}일*\n\n"
        f"bags.fm 공식 지갑:\n"
        f"`{BAGS_WALLET[:20]}...`\n\n"
        f"_Total members: {st['count']} · {st['total_sol']:.1f} SOL participating_\n"
        f"_{day} days of OG community_"
    )

    kb = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("🤝 참여하기", callback_data="sign_flow"),
            InlineKeyboardButton("📋 목록", callback_data="show_list")
        ],
        [InlineKeyboardButton("🌐 웹앱 전체 데이터", url="https://og-ledger.xyz")]
    ])
    await update.message.reply_text(text, parse_mode="Markdown", reply_markup=kb)


async def cmd_list(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    # Try to fetch from backend API first
    result = await api_get("/api/og/registry")
    
    if result.get("success"):
        data = result.get("data", {})
        members = data.get("members", [])
        if not members:
            await update.message.reply_text(
                "아직 멤버가 없습니다.\n"
                "`/verify [지갑]` → `/register` 또는 `/sign` 으로 첫 번째 멤버가 되어주세요!\n\n"
                "_No members yet. Be the first!_",
                parse_mode="Markdown"
            )
            return
        
        # Sort by sol_amount descending
        sorted_members = sorted(members, key=lambda x: x.get("sol_amount", 0), reverse=True)
        lines = []
        for i, m in enumerate(sorted_members[:30], 1):
            wallet = m.get("wallet", "")
            sol = m.get("sol_amount", 0.0)
            lines.append(f"#{i:03d} {short(wallet)} — {sol:.1f} SOL")
        
        text = (
            f"👥 *멤버 목록 / Members ({len(members)}명)*\n\n"
            + "\n".join(lines)
        )
        if len(members) > 30:
            text += f"\n\n_...and {len(members)-30} more on og-ledger.xyz_"
        
        await update.message.reply_text(text, parse_mode="Markdown")
    else:
        # Fallback to in-memory store
        log.info("cmd_list() falling back to in-memory store")
        signers = store["signers"]
        if not signers:
            await update.message.reply_text(
                "아직 멤버가 없습니다.\n"
                "`/verify [지갑]` → `/register` 또는 `/sign` 으로 첫 번째 멤버가 되어주세요!\n\n"
                "_No members yet. Be the first!_",
                parse_mode="Markdown"
            )
            return

        sorted_s = sorted(signers.values(), key=lambda x: x["sol"], reverse=True)
        lines = []
        for v in sorted_s[:30]:
            name = v.get("display_name") or short(v["wallet"])
            lines.append(f"#{v['rank']:03d} {name} — {v['sol']:.1f} SOL")

        text = (
            f"👥 *멤버 목록 / Members ({len(signers)}명)*\n\n"
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
            "`/verify [솔라나 지갑 주소]` 후 `/register` 또는 `/sign`",
            parse_mode="Markdown"
        )

    elif data.startswith("do_register:"):
        parts  = data.split(":")
        wallet = parts[1]
        sol    = float(parts[2])

        if wallet in store["signers"]:
            await q.message.edit_text("✅ 이미 등록 완료된 지갑입니다.", parse_mode="Markdown")
            return

        await _do_register(update, ctx, wallet, sol, user)
    
    # Note: claim_all button removed - users should claim via web app
    # Note: launch callbacks are handled by ConversationHandler


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
            f"`/verify [지갑주소]` → `/register` 또는 `/sign` 순서로 등록해주세요.\n\n"
            f"_If you're an OG member:_\n"
            f"_/verify [wallet] → /register or /sign_\n\n"
            f"📢 채널: @OGLedgerChannel\n"
            f"🌐 웹앱: og-ledger.xyz"
        )
        await update.message.reply_text(text, parse_mode="Markdown")




# Launch conversation states
LAUNCH_NAME, LAUNCH_SYMBOL, LAUNCH_CONFIRM = range(3)


async def launch_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Start launch conversation - ask for token name."""
    await update.message.reply_text(
        "🚀 *토큰 런칭 / Token Launch*\n\n"
        "토큰 이름을 입력하세요:\n_Enter token name:_",
        parse_mode="Markdown"
    )
    return LAUNCH_NAME


async def launch_name(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Handle token name input."""
    user = update.effective_user
    name = update.message.text.strip()
    
    if not name or len(name) > 64:
        await update.message.reply_text(
            "❌ 토큰 이름은 1~64자여야 합니다.\n"
            "_Token name must be 1-64 characters._\n\n"
            "다시 입력해주세요:",
            parse_mode="Markdown"
        )
        return LAUNCH_NAME
    
    store["launch_data"][user.id] = {"name": name}
    
    await update.message.reply_text(
        f"✅ 이름: *{name}*\n\n"
        f"📝 *토큰 심볼을 입력하세요*\n"
        f"_Enter token symbol:_\n\n"
        f"예시: OGL\n"
        f"_Example: OGL_",
        parse_mode="Markdown"
    )
    return LAUNCH_SYMBOL


async def launch_symbol(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Handle token symbol input."""
    user = update.effective_user
    symbol = update.message.text.strip().upper()
    
    if not symbol or len(symbol) > 10:
        await update.message.reply_text(
            "❌ 토큰 심볼은 1~10자여야 합니다.\n"
            "_Token symbol must be 1-10 characters._\n\n"
            "다시 입력해주세요:",
            parse_mode="Markdown"
        )
        return LAUNCH_SYMBOL
    
    launch_data = store["launch_data"].get(user.id, {})
    launch_data["symbol"] = symbol
    store["launch_data"][user.id] = launch_data
    
    name = launch_data.get("name", "")
    
    # Show confirmation
    kb = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("✅ 런칭 / Launch", callback_data="launch_confirm"),
            InlineKeyboardButton("🚫 취소 / Cancel", callback_data="launch_cancel")
        ]
    ])
    
    await update.message.reply_text(
        f"🚀 *런칭 미리보기 / Launch Preview*\n\n"
        f"이름: *{name}*\n"
        f"심볼: *{symbol}*\n\n"
        f"런칭하시겠습니까?\n_Proceed with launch?_",
        parse_mode="Markdown",
        reply_markup=kb
    )
    return LAUNCH_CONFIRM


async def launch_confirm_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Execute token launch via callback."""
    q = update.callback_query
    await q.answer()
    user = update.effective_user
    
    if q.data == "launch_cancel":
        store["launch_data"].pop(user.id, None)
        await q.message.edit_text("🚫 런칭이 취소되었습니다.\n_Launch cancelled._", parse_mode="Markdown")
        return ConversationHandler.END
    
    launch_data = store["launch_data"].get(user.id, {})
    name = launch_data.get("name", "")
    symbol = launch_data.get("symbol", "")
    
    if not name or not symbol:
        await q.message.edit_text("❌ 런칭 데이터가 없습니다. `/launch` 명령어로 다시 시작하세요.", parse_mode="Markdown")
        return ConversationHandler.END
    
    await q.message.edit_text("⏳ 토큰 메타데이터 생성 중...\n_Creating token metadata..._", parse_mode="Markdown")
    
    result = await api_post("/api/launch/preview", {"name": name, "symbol": symbol})
    
    if result.get("success"):
        data = result.get("data", {})
        metadata_uri = data.get("metadataUri", "N/A")
        await q.message.edit_text(
            f"✅ *토큰 메타데이터 생성 완료!*\n"
            f"_Token metadata created!_\n\n"
            f"이름: *{name}*\n"
            f"심볼: *{symbol}*\n"
            f"메타데이터: `{metadata_uri}`\n\n"
            f"💡 웹앱에서 지갑 서명으로 런칭을 완료하세요.\n"
            f"_Complete launch by signing in the web app._",
            parse_mode="Markdown"
        )
    else:
        msg = result.get("message", "Unknown error")
        await q.message.edit_text(
            f"❌ *런칭 실패 / Launch failed*\n\n`{msg}`",
            parse_mode="Markdown"
        )
    
    store["launch_data"].pop(user.id, None)
    return ConversationHandler.END


async def launch_cancel_inline(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Fallback cancel for the conversation."""
    user = update.effective_user
    store["launch_data"].pop(user.id, None)
    await update.message.reply_text("🚫 런칭이 취소되었습니다.\n_Launch cancelled._", parse_mode="Markdown")
    return ConversationHandler.END


async def cmd_claim(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not ctx.args:
        await update.message.reply_text(
            "💰 *수수료 청구 / Claim Fees*\n\n"
            "사용법: `/claim [지갑주소]`\n_Usage: /claim [wallet address]_\n\n"
            "예시: `/claim 3nCpr7q...AbCd`",
            parse_mode="Markdown"
        )
        return
    
    wallet = ctx.args[0].strip()
    if not (32 <= len(wallet) <= 50):
        await update.message.reply_text("❌ 유효하지 않은 지갑 주소입니다.\n_Invalid wallet address._", parse_mode="Markdown")
        return
    
    msg = await update.message.reply_text("🔍 청구 가능한 포지션 조회 중...\n_Fetching claimable positions..._", parse_mode="Markdown")
    
    result = await api_get(f"/api/claim/{wallet}")
    
    if not result.get("success"):
        await msg.edit_text(
            f"⚠️ *API 오류*\n`{result.get('message', 'Unknown error')}`",
            parse_mode="Markdown"
        )
        return
    
    data = result.get("data", {})
    positions = data.get("positions", data.get("data", []))
    
    if not positions or (isinstance(positions, list) and len(positions) == 0):
        await msg.edit_text(
            f"📭 *청구 가능한 수수료가 없습니다*\n"
            f"_No claimable fees found_\n\n"
            f"지갑: `{short(wallet)}`\n\n"
            f"💡 OG 멤버로 런칭한 토큰에서 거래가 발생하면 수수료가 쌓입니다.\n"
            f"_Fees accumulate from trading on tokens you launched as OG._",
            parse_mode="Markdown"
        )
        return
    
    # Format positions list
    lines = []
    if isinstance(positions, list):
        for i, pos in enumerate(positions[:10], 1):
            mint = pos.get("mint", pos.get("tokenMint", "unknown"))
            amount = pos.get("claimableAmount", pos.get("amount", "0"))
            token_name = pos.get("name", pos.get("tokenName", short(mint) if isinstance(mint, str) else "?"))
            lines.append(f"{i}. *{token_name}* — `{amount}`")
    
    text = (
        f"💰 *청구 가능한 수수료 / Claimable Fees*\n\n"
        f"지갑: `{short(wallet)}`\n\n"
        + ("\n".join(lines) if lines else f"원본 데이터:\n```\n{json.dumps(data, indent=2)[:500]}\n```")
    )
    
    text += (
        f"\n\n💡 웹앱에서 지갑 서명으로 청구를 완료하세요.\n"
        f"_Complete claim by signing in the web app._"
    )
    
    kb = InlineKeyboardMarkup([[
        InlineKeyboardButton("🌐 웹앱에서 청구", url="https://og-ledger.xyz")
    ]])
    
    await msg.edit_text(text, parse_mode="Markdown", reply_markup=kb)


async def cmd_portfolio(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not ctx.args:
        await update.message.reply_text(
            "📊 *포트폴리오 / Portfolio*\n\n"
            "사용법: `/portfolio [지갑주소]`\n_Usage: /portfolio [wallet address]_\n\n"
            "예시: `/portfolio 3nCpr7q...AbCd`",
            parse_mode="Markdown"
        )
        return
    
    wallet = ctx.args[0].strip()
    if not (32 <= len(wallet) <= 50):
        await update.message.reply_text("❌ 유효하지 않은 지갑 주소입니다.\n_Invalid wallet address._", parse_mode="Markdown")
        return
    
    msg = await update.message.reply_text("📊 포트폴리오 조회 중...\n_Loading portfolio..._", parse_mode="Markdown")
    
    # Fetch verify status + claimable positions in parallel
    verify_task = api_get(f"/api/og/verify/{wallet}")
    claim_task = api_get(f"/api/claim/{wallet}")
    
    verify_result, claim_result = await asyncio.gather(verify_task, claim_task)
    
    # Build portfolio text
    sections = []
    
    # OG Status section
    if verify_result.get("success"):
        v_data = verify_result.get("data", {})
        if v_data.get("verified"):
            sol = v_data.get("solAmount", 0)
            sections.append(
                f"✅ *OG 멤버 인증됨*\n"
                f"   투자: `{sol:.1f} SOL`\n"
                f"   지갑: `{short(wallet)}`"
            )
        else:
            sections.append(f"❌ OG 미인증\n   _Not verified as OG_")
    else:
        sections.append(f"⚠️ OG 상태 확인 불가\n   _Could not check OG status_")
    
    # Claimable fees section
    if claim_result.get("success"):
        c_data = claim_result.get("data", {})
        positions = c_data.get("positions", c_data.get("data", []))
        if isinstance(positions, list) and len(positions) > 0:
            sections.append(
                f"💰 *청구 가능 수수료: {len(positions)}건*\n"
                f"   _Claimable positions: {len(positions)}_"
            )
            for pos in positions[:5]:
                mint = pos.get("mint", pos.get("tokenMint", "unknown"))
                amount = pos.get("claimableAmount", pos.get("amount", "0"))
                token_name = pos.get("name", pos.get("tokenName", short(mint) if isinstance(mint, str) else "?"))
                sections.append(f"   • *{token_name}*: `{amount}`")
            if len(positions) > 5:
                sections.append(f"   _...and {len(positions)-5} more_")
        else:
            sections.append("📭 청구 가능 수수료 없음\n   _No claimable fees_")
    else:
        sections.append("⚠️ 수수료 조회 불가\n   _Could not fetch claimable fees_")
    
    # Community stats
    stats = await member_stats()
    sections.append(
        f"\n📈 *커뮤니티 현황*\n"
        f"   멤버: {stats['count']}명\n"
        f"   총 투자: {stats['total_sol']:.1f} SOL\n"
        f"   활동일: {days_since_og()}일"
    )
    
    text = f"📊 *포트폴리오 / Portfolio*\n{'━' * 20}\n\n" + "\n\n".join(sections)
    
    kb = InlineKeyboardMarkup([[
        InlineKeyboardButton("🌐 웹앱 전체 보기", url="https://og-ledger.xyz")
    ]])
    
    await msg.edit_text(text, parse_mode="Markdown", reply_markup=kb)


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

    log.info("스케줄러 설정 완료 (매일 00:00 카운터 · 30분 공지 모니터링)")
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
    log.info(f"  Backend API: {BACKEND_URL}")
    if X_SOURCE == "disabled":
        monitor_mode = "OFF"
    elif TWITTER_BEARER and X_SOURCE in ("auto", "api"):
        monitor_mode = "X API"
    elif RSS_FEEDS and X_SOURCE in ("auto", "rss"):
        monitor_mode = "RSS"
    else:
        monitor_mode = "OFF"
    log.info(f"  공지 모니터링: {monitor_mode}")
    log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

    app = (
        Application.builder()
        .token(BOT_TOKEN)
        .post_init(post_init)
        .build()
    )

    # Launch conversation handler
    launch_conv = ConversationHandler(
        entry_points=[CommandHandler("launch", launch_start)],
        states={
            LAUNCH_NAME: [MessageHandler(filters.TEXT & ~filters.COMMAND, launch_name)],
            LAUNCH_SYMBOL: [MessageHandler(filters.TEXT & ~filters.COMMAND, launch_symbol)],
            LAUNCH_CONFIRM: [CallbackQueryHandler(launch_confirm_cb, pattern="^launch_")],
        },
        fallbacks=[CommandHandler("cancel", launch_cancel_inline)],
    )

    # 명령어
    app.add_handler(CommandHandler("start",    cmd_start))
    app.add_handler(CommandHandler("verify",   cmd_verify))
    app.add_handler(CommandHandler("register", cmd_register))
    app.add_handler(CommandHandler("sign",     cmd_register))
    # /launch is handled by launch_conv ConversationHandler below
    app.add_handler(CommandHandler("claim",    cmd_claim))
    app.add_handler(CommandHandler("portfolio", cmd_portfolio))
    app.add_handler(CommandHandler("status",   cmd_status))
    app.add_handler(CommandHandler("list",     cmd_list))
    app.add_handler(CommandHandler("announce", cmd_announce))

    # Launch conversation handler
    app.add_handler(launch_conv)

    # 콜백
    app.add_handler(CallbackQueryHandler(on_callback))

    # 새 멤버
    app.add_handler(MessageHandler(filters.StatusUpdate.NEW_CHAT_MEMBERS, on_new_member))

    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
