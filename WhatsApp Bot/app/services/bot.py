import asyncio
import logging
import re
from datetime import date, datetime, timedelta
from decimal import Decimal
from time import monotonic
from uuid import UUID
from zoneinfo import ZoneInfo

from python_whatsapp_bot import Inline_button, Inline_keyboard, Inline_list, List_item, Whatsapp
from requests import HTTPError
from sqlalchemy.ext.asyncio import async_sessionmaker
from starlette.concurrency import run_in_threadpool

from app.config import Settings
from app.db import SessionLocal, shop_scoped_session
from app.schemas import (
    BotStage,
    BranchRead,
    ConversationState,
    IncomingMessageKind,
    IncomingUserMessage,
    SalesSummaryResponse,
    WhatsAppWebhookPayload,
)
from app.services.sales import get_sales_summary, list_active_branches

logger = logging.getLogger(__name__)

START_KEYWORDS = {"start", "hi", "hello", "menu", "hai", "hey", "hii", "hlo"}
TODAY_KEYWORDS = {"1", "today", "today sale", "today's sale", "todays sale"}
DATE_RANGE_KEYWORDS = {"2", "custom", "custom range", "date range", "range", "dates"}
START_DEBOUNCE_SECONDS = 12
BRANCH_CACHE_TTL_SECONDS = 30
DATE_RANGE_PATTERN = re.compile(
    r"^\s*(\d{2}-\d{2}-\d{4})(?:\s+to\s+(\d{2}-\d{2}-\d{4}))?\s*$",
    flags=re.IGNORECASE,
)
NUMBERED_BRANCH_PATTERN = re.compile(r"^\s*(\d+)\.\s*(.+?)\s*$")
IGNORED_BRANCH_PROMPT_LINES = {
    "select branch",
    "reply with the branch name or choose from the list below.",
    "tap to view sales options",
}


class ConversationStore:
    def __init__(self) -> None:
        self._states: dict[str, ConversationState] = {}
        self._lock = asyncio.Lock()

    async def get(self, phone_number: str) -> ConversationState:
        async with self._lock:
            state = self._states.get(phone_number)
            if state is None:
                state = ConversationState(phone_number=phone_number)
                self._states[phone_number] = state
            return state

    async def save(self, state: ConversationState) -> ConversationState:
        async with self._lock:
            state.updated_at = datetime.utcnow()
            self._states[state.phone_number] = state
            return state

    async def reset(self, phone_number: str) -> ConversationState:
        state = ConversationState(phone_number=phone_number)
        return await self.save(state)


class WhatsAppClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._client: Whatsapp | None = None

    def _get_client(self) -> Whatsapp:
        if not self.settings.whatsapp_access_token or not self.settings.whatsapp_phone_number_id:
            raise RuntimeError(
                "WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID must be configured."
            )
        if self._client is None:
            self._client = Whatsapp(
                number_id=int(self.settings.whatsapp_phone_number_id),
                token=self.settings.whatsapp_access_token,
                mark_as_read=False,
            )
        return self._client

    async def send_text(self, phone_number: str, text: str, reply_markup=None) -> None:
        client = self._get_client()
        logger.info(
            "Sending WhatsApp reply to %s using %s message",
            phone_number,
            "interactive" if reply_markup else "text",
        )
        response = await run_in_threadpool(
            client.send_message,
            phone_number,
            text,
            "",
            reply_markup,
        )
        logger.info(
            "WhatsApp send response status=%s body=%s",
            response.status_code,
            response.text[:500],
        )
        try:
            response.raise_for_status()
        except HTTPError:
            logger.exception(
                "WhatsApp send failed for %s status=%s body=%s",
                phone_number,
                response.status_code,
                response.text[:1000],
            )
            raise

    async def send_branch_prompt(
        self,
        phone_number: str,
        branches: list[BranchRead],
    ) -> None:
        if not branches:
            await self.send_text(phone_number, "No active branches are available right now.")
            return

        intro = "Select Branch\nTap a branch from the list below."
        if len(branches) <= 10:
            reply_markup = Inline_list(
                "Select Branch",
                [
                    List_item(
                        branch.name,
                        _id=f"branch::{branch.id}",
                        description="Tap to view sales options",
                    )
                    for branch in branches
                ],
            )
            await self.send_text(phone_number, intro, reply_markup=reply_markup)
            return

        lines = [intro]
        for index, branch in enumerate(branches, start=1):
            lines.append(f"{index}. {branch.name}")
        await self.send_text(phone_number, "\n".join(lines))

    async def send_action_prompt(self, phone_number: str, branch_name: str) -> None:
        reply_markup = Inline_keyboard(
            [
                Inline_button("Today's sale", button_id="sales::today"),
                Inline_button("Custom range", button_id="sales::dates"),
            ]
        )
        text = (
            f"Branch selected: {branch_name}\n"
            "Choose an option by tapping a button:\n"
            "1. Today's sale\n"
            "2. Custom range"
        )
        await self.send_text(phone_number, text, reply_markup=reply_markup)

    async def send_date_range_prompt(self, phone_number: str, branch_name: str) -> None:
        reply_markup = Inline_list(
            "Choose dates",
            [
                List_item("Today", _id="range::today", description="Current day sales"),
                List_item("Yesterday", _id="range::yesterday", description="Previous day sales"),
                List_item("Last 7 days", _id="range::last7", description="Rolling weekly summary"),
                List_item("Last 30 days", _id="range::last30", description="Rolling monthly summary"),
                List_item("This month", _id="range::this_month", description="Current calendar month"),
                List_item("Previous month", _id="range::previous_month", description="Last calendar month"),
            ],
        )
        await self.send_text(
            phone_number,
            (
                f"Branch selected: {branch_name}\n"
                "Choose a date range from the list below, or send:\n"
                "dd-mm-yyyy to dd-mm-yyyy\n"
                "Example: 01-05-2026 to 27-05-2026"
            ),
            reply_markup=reply_markup,
        )

    async def send_sales_summary(
        self,
        phone_number: str,
        summary: SalesSummaryResponse,
        *,
        reply_markup=None,
        follow_up_hint: str | None = None,
    ) -> None:
        label = (
            f"Date: {summary.from_date.isoformat()}"
            if summary.from_date == summary.to_date
            else f"Date Range: {summary.from_date.isoformat()} to {summary.to_date.isoformat()}"
        )
        lines = [
            f"Branch: {summary.shop_name}",
            label,
            "",
            "Items / total (kg/unit) / total revenue",
        ]
        if not summary.items:
            lines.append("No sales found for this period.")
        else:
            for item in summary.items:
                lines.append(
                    f"{item.item_name} / {format_quantity(item.total_quantity)} {item.unit.value} / {format_amount(item.total_revenue)}"
                )
        if follow_up_hint:
            lines.extend(["", follow_up_hint])
        await self.send_text(phone_number, "\n".join(lines), reply_markup=reply_markup)


class BotOrchestrator:
    def __init__(
        self,
        settings: Settings,
        session_factory: async_sessionmaker = SessionLocal,
        conversation_store: ConversationStore | None = None,
        whatsapp_client: WhatsAppClient | None = None,
    ) -> None:
        self.settings = settings
        self.session_factory = session_factory
        self.conversation_store = conversation_store or ConversationStore()
        self.whatsapp_client = whatsapp_client or WhatsAppClient(settings)
        self._branch_cache: list[BranchRead] = []
        self._branch_cache_expires_at = 0.0
        self._branch_cache_lock = asyncio.Lock()

    async def handle_webhook(self, payload: WhatsAppWebhookPayload) -> int:
        incoming_messages = extract_incoming_messages(payload)
        if incoming_messages:
            logger.info(
                "Extracted %s incoming WhatsApp message(s): %s",
                len(incoming_messages),
                [
                    {
                        "from": message.phone_number,
                        "kind": message.kind.value,
                        "content": message.content,
                    }
                    for message in incoming_messages
                ],
            )
        else:
            logger.warning(
                "Webhook payload contained no supported incoming WhatsApp messages: %s",
                describe_webhook_payload(payload),
            )

        processed_messages = 0
        for incoming_message in incoming_messages:
            try:
                await self.handle_message(incoming_message)
            except Exception:
                logger.exception(
                    "Failed to process WhatsApp message id=%s from=%s kind=%s content=%r",
                    incoming_message.message_id,
                    incoming_message.phone_number,
                    incoming_message.kind.value,
                    incoming_message.content,
                )
                continue
            processed_messages += 1
        return processed_messages

    async def handle_message(self, message: IncomingUserMessage) -> None:
        normalized = normalize_text(message.content)
        state = await self.conversation_store.get(message.phone_number)
        if normalized in START_KEYWORDS:
            if self._should_debounce_start(state):
                logger.info(
                    "Skipping duplicate start command for %s while branch selection is already pending.",
                    message.phone_number,
                )
                return
            await self._start_conversation(message.phone_number)
            return

        if message.content.startswith("branch::"):
            await self._select_branch(message.phone_number, message.content)
            return

        if state.stage == BotStage.AWAITING_ACTION and normalized in TODAY_KEYWORDS:
            await self._send_today_sales(state)
            return

        if state.stage == BotStage.AWAITING_ACTION and normalized in DATE_RANGE_KEYWORDS:
            state.stage = BotStage.AWAITING_DATE_RANGE
            await self.conversation_store.save(state)
            await self.whatsapp_client.send_date_range_prompt(
                message.phone_number,
                state.branch_name or "selected branch",
            )
            return

        if message.kind == IncomingMessageKind.INTERACTIVE and message.content == "sales::today":
            await self._send_today_sales(state)
            return

        if message.kind == IncomingMessageKind.INTERACTIVE and message.content == "sales::dates":
            state.stage = BotStage.AWAITING_DATE_RANGE
            await self.conversation_store.save(state)
            await self.whatsapp_client.send_date_range_prompt(
                message.phone_number,
                state.branch_name or "selected branch",
            )
            return

        if state.stage == BotStage.AWAITING_DATE_RANGE and message.kind == IncomingMessageKind.INTERACTIVE:
            await self._send_preset_range_sales(state, message.content)
            return

        if state.stage == BotStage.AWAITING_DATE_RANGE:
            await self._send_custom_range_sales(state, message.content)
            return

        if state.stage == BotStage.AWAITING_BRANCH:
            await self._select_branch(message.phone_number, message.content)
            return

        await self.whatsapp_client.send_text(
            message.phone_number,
            "Send `start` or `hi` to begin, then tap a branch and choose a sales option.",
        )

    async def _start_conversation(self, phone_number: str) -> None:
        state = await self.conversation_store.reset(phone_number)
        state.last_branch_prompt_at = datetime.utcnow()
        await self.conversation_store.save(state)
        branches = await self._list_active_branches()
        await self.whatsapp_client.send_branch_prompt(phone_number, branches)

    async def _select_branch(self, phone_number: str, raw_selection: str) -> None:
        branches = await self._list_active_branches()
        branch = resolve_branch_selection(raw_selection, branches)
        if branch is None:
            await self.whatsapp_client.send_text(
                phone_number,
                "I couldn't match that branch. Send `start` again and choose a branch from the list.",
            )
            return

        state = await self.conversation_store.get(phone_number)
        state.branch_id = branch.id
        state.branch_name = branch.name
        state.stage = BotStage.AWAITING_ACTION
        await self.conversation_store.save(state)
        await self.whatsapp_client.send_action_prompt(phone_number, branch.name)

    async def _send_today_sales(self, state: ConversationState) -> None:
        if state.branch_id is None:
            await self._start_conversation(state.phone_number)
            return

        today = datetime.now(ZoneInfo(self.settings.app_timezone)).date()
        async with shop_scoped_session(state.branch_id) as session:
            summary = await get_sales_summary(
                session=session,
                shop_id=state.branch_id,
                from_date=today,
                to_date=today,
                timezone_name=self.settings.app_timezone,
            )
        await self._finish_sales_response(state, summary)

    async def _send_custom_range_sales(
        self,
        state: ConversationState,
        raw_range: str,
    ) -> None:
        if state.branch_id is None:
            await self._start_conversation(state.phone_number)
            return

        parsed_range = parse_date_range(raw_range)
        if parsed_range is None:
            await self.whatsapp_client.send_date_range_prompt(
                state.phone_number,
                state.branch_name or "selected branch",
            )
            return

        from_date, to_date = parsed_range
        async with shop_scoped_session(state.branch_id) as session:
            summary = await get_sales_summary(
                session=session,
                shop_id=state.branch_id,
                from_date=from_date,
                to_date=to_date,
                timezone_name=self.settings.app_timezone,
            )
        await self._finish_sales_response(state, summary)

    async def _send_preset_range_sales(
        self,
        state: ConversationState,
        selection: str,
    ) -> None:
        if state.branch_id is None:
            await self._start_conversation(state.phone_number)
            return

        parsed_range = resolve_preset_range(selection, self.settings.app_timezone)
        if parsed_range is None:
            await self.whatsapp_client.send_date_range_prompt(
                state.phone_number,
                state.branch_name or "selected branch",
            )
            return

        from_date, to_date = parsed_range
        async with shop_scoped_session(state.branch_id) as session:
            summary = await get_sales_summary(
                session=session,
                shop_id=state.branch_id,
                from_date=from_date,
                to_date=to_date,
                timezone_name=self.settings.app_timezone,
            )
        await self._finish_sales_response(state, summary)

    async def _finish_sales_response(
        self,
        state: ConversationState,
        summary: SalesSummaryResponse,
    ) -> None:
        state.stage = BotStage.AWAITING_ACTION
        await self.conversation_store.save(state)
        reply_markup = Inline_keyboard(
            [
                Inline_button("Today's sale", button_id="sales::today"),
                Inline_button("Custom range", button_id="sales::dates"),
            ]
        )
        await self.whatsapp_client.send_sales_summary(
            state.phone_number,
            summary,
            reply_markup=reply_markup,
            follow_up_hint="Choose the next option by tapping a button below.",
        )

    async def _list_active_branches(self) -> list[BranchRead]:
        now = monotonic()
        if self._branch_cache and now < self._branch_cache_expires_at:
            return self._branch_cache

        async with self._branch_cache_lock:
            now = monotonic()
            if self._branch_cache and now < self._branch_cache_expires_at:
                return self._branch_cache

            async with self.session_factory() as session:
                branches = await list_active_branches(session)

            self._branch_cache = branches
            self._branch_cache_expires_at = monotonic() + BRANCH_CACHE_TTL_SECONDS
            return branches

    def _should_debounce_start(self, state: ConversationState) -> bool:
        if (
            state.stage != BotStage.AWAITING_BRANCH
            or state.branch_id is not None
            or state.last_branch_prompt_at is None
        ):
            return False
        return (
            datetime.utcnow() - state.last_branch_prompt_at
        ).total_seconds() < START_DEBOUNCE_SECONDS


def extract_incoming_messages(payload: WhatsAppWebhookPayload) -> list[IncomingUserMessage]:
    messages: list[IncomingUserMessage] = []
    for entry in payload.entry:
        for change in entry.changes:
            contacts = change.value.contacts
            display_name = contacts[0].profile.name if contacts and contacts[0].profile else None
            for message in change.value.messages:
                if message.type == "text" and message.text:
                    messages.append(
                        IncomingUserMessage(
                            phone_number=message.from_phone,
                            message_id=message.id,
                            display_name=display_name,
                            content=message.text.body,
                            kind=IncomingMessageKind.TEXT,
                        )
                    )
                elif message.type == "interactive" and message.interactive:
                    reply = message.interactive.button_reply or message.interactive.list_reply
                    if reply:
                        messages.append(
                            IncomingUserMessage(
                                phone_number=message.from_phone,
                                message_id=message.id,
                                display_name=display_name,
                                content=reply.id,
                                kind=IncomingMessageKind.INTERACTIVE,
                            )
                        )
                elif message.type == "button" and message.button:
                    payload_id = message.button.payload or message.button.text
                    if payload_id:
                        messages.append(
                            IncomingUserMessage(
                                phone_number=message.from_phone,
                                message_id=message.id,
                                display_name=display_name,
                                content=payload_id,
                                kind=IncomingMessageKind.INTERACTIVE,
                            )
                        )
    return messages


def describe_webhook_payload(payload: WhatsAppWebhookPayload) -> dict[str, object]:
    message_types: list[str] = []
    unsupported_messages: list[dict[str, str | None]] = []
    raw_message_count = 0

    for entry in payload.entry:
        for change in entry.changes:
            for message in change.value.messages:
                raw_message_count += 1
                message_types.append(message.type)
                if message.type in {"text", "interactive", "button"}:
                    continue
                unsupported_messages.append(
                    {
                        "message_id": message.id,
                        "type": message.type,
                        "from": message.from_phone,
                    }
                )

    return {
        "entries": len(payload.entry),
        "raw_message_count": raw_message_count,
        "message_types": sorted(set(message_types)),
        "unsupported_messages": unsupported_messages,
    }


def normalize_text(text: str) -> str:
    return " ".join(text.strip().lower().strip("`'\".,!?").split())


def resolve_branch_selection(
    raw_selection: str,
    branches: list[BranchRead],
) -> BranchRead | None:
    if raw_selection.startswith("branch::"):
        raw_id = raw_selection.split("::", maxsplit=1)[1]
        try:
            branch_id = UUID(raw_id)
        except ValueError:
            return None
        return next((branch for branch in branches if branch.id == branch_id), None)

    candidate_values = extract_branch_candidates(raw_selection)
    for candidate in candidate_values:
        if candidate.isdigit():
            index = int(candidate) - 1
            if 0 <= index < len(branches):
                return branches[index]

        lowered = candidate.casefold()
        branch = next((item for item in branches if item.name.casefold() == lowered), None)
        if branch is not None:
            return branch
    return None


def extract_branch_candidates(raw_selection: str) -> list[str]:
    candidates: list[str] = []

    def add_candidate(value: str) -> None:
        cleaned = value.strip()
        if not cleaned:
            return
        if cleaned.casefold() in {candidate.casefold() for candidate in candidates}:
            return
        candidates.append(cleaned)

    add_candidate(raw_selection)

    for line in raw_selection.splitlines():
        cleaned_line = line.strip()
        if not cleaned_line:
            continue
        if cleaned_line.casefold() in IGNORED_BRANCH_PROMPT_LINES:
            continue
        numbered_match = NUMBERED_BRANCH_PATTERN.match(cleaned_line)
        if numbered_match:
            index_text, branch_name = numbered_match.groups()
            add_candidate(index_text)
            add_candidate(branch_name)
            continue
        add_candidate(cleaned_line)

    return candidates


def parse_date_range(raw_value: str) -> tuple[date, date] | None:
    match = DATE_RANGE_PATTERN.match(raw_value)
    if not match:
        return None

    start_text, end_text = match.groups()
    try:
        from_date = parse_user_date(start_text)
        to_date = parse_user_date(end_text or start_text)
    except ValueError:
        return None

    if to_date < from_date:
        return None
    return from_date, to_date


def parse_user_date(raw_value: str) -> date:
    return datetime.strptime(raw_value, "%d-%m-%Y").date()


def resolve_preset_range(
    raw_value: str,
    timezone_name: str,
) -> tuple[date, date] | None:
    normalized = normalize_text(raw_value)
    today = datetime.now(ZoneInfo(timezone_name)).date()

    if normalized == "range::today":
        return today, today
    if normalized == "range::yesterday":
        yesterday = today - timedelta(days=1)
        return yesterday, yesterday
    if normalized == "range::last7":
        return today - timedelta(days=6), today
    if normalized == "range::last30":
        return today - timedelta(days=29), today
    if normalized == "range::this_month":
        return today.replace(day=1), today
    if normalized == "range::previous_month":
        this_month_start = today.replace(day=1)
        previous_month_end = this_month_start - timedelta(days=1)
        previous_month_start = previous_month_end.replace(day=1)
        return previous_month_start, previous_month_end

    return None


def format_quantity(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.001'))}"


def format_amount(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.01'))}"
