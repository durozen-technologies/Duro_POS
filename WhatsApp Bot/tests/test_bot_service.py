import importlib
import sys
import unittest
from datetime import date
from pathlib import Path
from uuid import UUID

BOT_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BOT_DIR.parent

sys.path.insert(0, str(BOT_DIR))
sys.path.insert(1, str(REPO_ROOT))

schemas = importlib.import_module("app.schemas")
bot_service = importlib.import_module("app.services.bot")

IncomingMessageKind = schemas.IncomingMessageKind
WhatsAppWebhookPayload = schemas.WhatsAppWebhookPayload
describe_webhook_payload = bot_service.describe_webhook_payload
extract_incoming_messages = bot_service.extract_incoming_messages
BotOrchestrator = bot_service.BotOrchestrator
ConversationStore = bot_service.ConversationStore
IncomingUserMessage = schemas.IncomingUserMessage
Settings = importlib.import_module("app.config").Settings
resolve_branch_selection = bot_service.resolve_branch_selection
parse_date_range = bot_service.parse_date_range
resolve_preset_range = bot_service.resolve_preset_range
BranchRead = schemas.BranchRead


def build_payload(message: dict) -> WhatsAppWebhookPayload:
    return WhatsAppWebhookPayload.model_validate(
        {
            "object": "whatsapp_business_account",
            "entry": [
                {
                    "changes": [
                        {
                            "field": "messages",
                            "value": {
                                "contacts": [
                                    {
                                        "wa_id": "919999999999",
                                        "profile": {"name": "Sachinn"},
                                    }
                                ],
                                "messages": [message],
                            },
                        }
                    ]
                }
            ],
        }
    )


class ExtractIncomingMessagesTests(unittest.TestCase):
    def test_extracts_text_messages(self) -> None:
        payload = build_payload(
            {
                "from": "919999999999",
                "id": "wamid.text",
                "timestamp": "1710000000",
                "type": "text",
                "text": {"body": "Hi"},
            }
        )

        messages = extract_incoming_messages(payload)

        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0].content, "Hi")
        self.assertEqual(messages[0].kind, IncomingMessageKind.TEXT)

    def test_extracts_interactive_list_replies(self) -> None:
        payload = build_payload(
            {
                "from": "919999999999",
                "id": "wamid.list",
                "timestamp": "1710000001",
                "type": "interactive",
                "interactive": {
                    "type": "list_reply",
                    "list_reply": {
                        "id": "branch::1234",
                        "title": "Test Branch",
                        "description": "Tap to view sales options",
                    },
                },
            }
        )

        messages = extract_incoming_messages(payload)

        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0].content, "branch::1234")
        self.assertEqual(messages[0].kind, IncomingMessageKind.INTERACTIVE)

    def test_extracts_button_replies(self) -> None:
        payload = build_payload(
            {
                "from": "919999999999",
                "id": "wamid.button",
                "timestamp": "1710000002",
                "type": "button",
                "button": {
                    "text": "Today's sale",
                    "payload": "sales::today",
                },
            }
        )

        messages = extract_incoming_messages(payload)

        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0].content, "sales::today")
        self.assertEqual(messages[0].kind, IncomingMessageKind.INTERACTIVE)

    def test_describes_unsupported_message_types(self) -> None:
        payload = build_payload(
            {
                "from": "919999999999",
                "id": "wamid.image",
                "timestamp": "1710000003",
                "type": "image",
            }
        )

        summary = describe_webhook_payload(payload)

        self.assertEqual(summary["raw_message_count"], 1)
        self.assertEqual(summary["message_types"], ["image"])
        self.assertEqual(
            summary["unsupported_messages"],
            [
                {
                    "message_id": "wamid.image",
                    "type": "image",
                    "from": "919999999999",
                }
            ],
        )


class BranchSelectionParsingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.branch = BranchRead(
            id=UUID("019e4945-380f-7782-9e1c-b767087a20ae"),
            name="SK Nagar",
            is_active=True,
        )

    def test_matches_exact_branch_name(self) -> None:
        selected = resolve_branch_selection("SK Nagar", [self.branch])
        self.assertEqual(selected, self.branch)

    def test_matches_copied_branch_prompt_text(self) -> None:
        selected = resolve_branch_selection(
            (
                "Select Branch\n"
                "Reply with the branch name or choose from the list below.\n"
                "SK Nagar\n"
                "Tap to view sales options"
            ),
            [self.branch],
        )
        self.assertEqual(selected, self.branch)

    def test_matches_numbered_branch_line(self) -> None:
        selected = resolve_branch_selection("1. SK Nagar", [self.branch])
        self.assertEqual(selected, self.branch)


class DateRangePresetTests(unittest.TestCase):
    def test_parses_user_date_range_format(self) -> None:
        self.assertEqual(
            parse_date_range("01-05-2026 to 27-05-2026"),
            (date(2026, 5, 1), date(2026, 5, 27)),
        )

    def test_parses_single_user_date_as_one_day_range(self) -> None:
        self.assertEqual(
            parse_date_range("27-05-2026"),
            (date(2026, 5, 27), date(2026, 5, 27)),
        )

    def test_rejects_iso_date_range_format(self) -> None:
        self.assertIsNone(parse_date_range("2026-05-01 to 2026-05-27"))

    def test_resolves_today_range(self) -> None:
        from_date, to_date = resolve_preset_range("range::today", "Asia/Kolkata")
        self.assertEqual(from_date, to_date)

    def test_resolves_last_seven_days_range(self) -> None:
        from_date, to_date = resolve_preset_range("range::last7", "Asia/Kolkata")
        self.assertEqual((to_date - from_date).days, 6)

    def test_rejects_unknown_preset(self) -> None:
        self.assertIsNone(resolve_preset_range("range::unknown", "Asia/Kolkata"))


class BotWebhookHandlingTests(unittest.IsolatedAsyncioTestCase):
    async def test_handle_webhook_continues_when_reply_send_fails(self) -> None:
        class FailingWhatsAppClient:
            async def send_branch_prompt(self, phone_number, branches) -> None:
                raise RuntimeError("send failed")

        class FakeSession:
            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

            async def execute(self, *_args, **_kwargs):
                class Result:
                    def scalars(self):
                        return self

                    def all(self):
                        return [
                            type(
                                "ShopRecord",
                                (),
                                {
                                    "id": UUID("019e4945-380f-7782-9e1c-b767087a20ae"),
                                    "name": "SK Nagar",
                                    "is_active": True,
                                },
                            )()
                        ]

                return Result()

        def session_factory():
            return FakeSession()

        orchestrator = BotOrchestrator(
            Settings(
                DATABASE_URL="postgresql+asyncpg://postgres:root@localhost:5432/duro_pos"
            ),
            session_factory=session_factory,
            conversation_store=ConversationStore(),
            whatsapp_client=FailingWhatsAppClient(),
        )
        payload = build_payload(
            {
                "from": "919999999999",
                "id": "wamid.text",
                "timestamp": "1710000000",
                "type": "text",
                "text": {"body": "hi"},
            }
        )

        processed_messages = await orchestrator.handle_webhook(payload)

        self.assertEqual(processed_messages, 0)

    async def test_hai_starts_conversation(self) -> None:
        class RecordingWhatsAppClient:
            def __init__(self) -> None:
                self.branch_prompt_calls = []

            async def send_branch_prompt(self, phone_number, branches) -> None:
                self.branch_prompt_calls.append((phone_number, branches))

        class FakeSession:
            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

            async def execute(self, *_args, **_kwargs):
                class Result:
                    def scalars(self):
                        return self

                    def all(self):
                        return [
                            type(
                                "ShopRecord",
                                (),
                                {
                                    "id": UUID("019e4945-380f-7782-9e1c-b767087a20ae"),
                                    "name": "SK Nagar",
                                    "is_active": True,
                                },
                            )()
                        ]

                return Result()

        def session_factory():
            return FakeSession()

        whatsapp_client = RecordingWhatsAppClient()
        orchestrator = BotOrchestrator(
            Settings(
                DATABASE_URL="postgresql+asyncpg://postgres:root@localhost:5432/duro_pos"
            ),
            session_factory=session_factory,
            conversation_store=ConversationStore(),
            whatsapp_client=whatsapp_client,
        )

        await orchestrator.handle_message(
            IncomingUserMessage(
                phone_number="919999999999",
                message_id="wamid.hai",
                display_name="Sachinn",
                content="hai",
                kind=IncomingMessageKind.TEXT,
            )
        )

        self.assertEqual(len(whatsapp_client.branch_prompt_calls), 1)

    async def test_duplicate_start_within_debounce_is_ignored(self) -> None:
        class RecordingWhatsAppClient:
            def __init__(self) -> None:
                self.branch_prompt_calls = []

            async def send_branch_prompt(self, phone_number, branches) -> None:
                self.branch_prompt_calls.append((phone_number, branches))

        class FakeSession:
            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

            async def execute(self, *_args, **_kwargs):
                class Result:
                    def scalars(self):
                        return self

                    def all(self):
                        return [
                            type(
                                "ShopRecord",
                                (),
                                {
                                    "id": UUID("019e4945-380f-7782-9e1c-b767087a20ae"),
                                    "name": "SK Nagar",
                                    "is_active": True,
                                },
                            )()
                        ]

                return Result()

        def session_factory():
            return FakeSession()

        whatsapp_client = RecordingWhatsAppClient()
        orchestrator = BotOrchestrator(
            Settings(
                DATABASE_URL="postgresql+asyncpg://postgres:root@localhost:5432/duro_pos"
            ),
            session_factory=session_factory,
            conversation_store=ConversationStore(),
            whatsapp_client=whatsapp_client,
        )

        message = IncomingUserMessage(
            phone_number="919999999999",
            message_id="wamid.hi1",
            display_name="Sachinn",
            content="hi",
            kind=IncomingMessageKind.TEXT,
        )
        await orchestrator.handle_message(message)
        await orchestrator.handle_message(message.model_copy(update={"message_id": "wamid.hi2"}))

        self.assertEqual(len(whatsapp_client.branch_prompt_calls), 1)

    async def test_interactive_date_range_selection_returns_summary_with_follow_up_actions(self) -> None:
        class RecordingWhatsAppClient:
            def __init__(self) -> None:
                self.sales_summary_calls = []

            async def send_sales_summary(
                self,
                phone_number,
                summary,
                *,
                reply_markup=None,
                follow_up_hint=None,
            ) -> None:
                self.sales_summary_calls.append(
                    (phone_number, summary, reply_markup, follow_up_hint)
                )

        class FakeSession:
            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

            async def scalar(self, *_args, **_kwargs):
                return type(
                    "ShopRecord",
                    (),
                    {
                        "id": UUID("019e4945-380f-7782-9e1c-b767087a20ae"),
                        "name": "SK Nagar",
                        "is_active": True,
                    },
                )()

            async def execute(self, *_args, **_kwargs):
                class Result:
                    def all(self):
                        return []

                return Result()

        def session_factory():
            return FakeSession()

        whatsapp_client = RecordingWhatsAppClient()
        orchestrator = BotOrchestrator(
            Settings(
                DATABASE_URL="postgresql+asyncpg://postgres:root@localhost:5432/duro_pos"
            ),
            session_factory=session_factory,
            conversation_store=ConversationStore(),
            whatsapp_client=whatsapp_client,
        )
        state = await orchestrator.conversation_store.get("919999999999")
        state.branch_id = UUID("019e4945-380f-7782-9e1c-b767087a20ae")
        state.branch_name = "SK Nagar"
        state.stage = schemas.BotStage.AWAITING_DATE_RANGE
        await orchestrator.conversation_store.save(state)

        await orchestrator.handle_message(
            IncomingUserMessage(
                phone_number="919999999999",
                message_id="wamid.range",
                display_name="Sachinn",
                content="range::today",
                kind=IncomingMessageKind.INTERACTIVE,
            )
        )

        self.assertEqual(len(whatsapp_client.sales_summary_calls), 1)
        _, _, reply_markup, follow_up_hint = whatsapp_client.sales_summary_calls[0]
        self.assertIsNotNone(reply_markup)
        self.assertIn("tapping a button", follow_up_hint)


if __name__ == "__main__":
    unittest.main()
