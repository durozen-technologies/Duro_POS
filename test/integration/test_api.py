from __future__ import annotations

from collections.abc import AsyncIterable
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from unittest.mock import Mock, patch
from app.core.ids import uuid7

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload

from test.support import AsyncSessionAdapter, BackendTestCase  # isort: skip

from app.db.storage import StoredImagePayload, StoredImageStreamPayload
from app.models import (
    BaseUnit,
    Bill,
    BillItem,
    BillStatus,
    DailyPrice,
    ExpenseItem,
    InventoryItem,
    Item,
    ItemChangeEvent,
    Payment,
    Shop,
    TransferShop,
    UnitType,
    User,
)
from app.routers.admin import (
    admin_report_pdf,
    allocate_shop_catalogue_item,
    allocate_shop_catalogue_items,
    allocate_shop_expenses,
    bill_detail,
    bill_details,
    bills,
    create_admin_expense_item,
    create_admin_inventory_category,
    create_admin_inventory_item_metadata,
    create_admin_item_category,
    create_inventory_item,
    create_shop,
    create_shop_inventory_item,
    confirm_admin_inventory_purchase_rates_today,
    deallocate_shop_catalogue_item,
    delete_admin_inventory_item_image,
    delete_admin_item_category,
    delete_inventory_item,
    delete_inventory_item_image,
    get_admin_inventory_item,
    get_catalogue_item_counts,
    get_catalogue_item_detail,
    get_catalogue_item_rows,
    get_catalogue_items,
    get_expense_history,
    get_expense_item_counts,
    get_expense_items,
    get_item_categories,
    get_selected_shop_item_counts,
    get_selected_shop_item_rows,
    get_selected_shop_items,
    get_shop_expense_item_candidates,
    get_shop_expense_items,
    get_shop_item_detail,
    get_shop_item_import_candidate_counts,
    get_shop_item_import_candidate_rows,
    get_shop_item_import_candidates,
    get_shop_items,
    get_shops,
    patch_admin_inventory_item_metadata,
    patch_admin_inventory_item_purchase_rate,
    confirm_admin_inventory_purchase_rates_today,
    patch_inventory_item_metadata,
    payment_summary,
    sales_summary,
    shop_daily_price,
    shop_daily_prices,
    shop_daily_prices_partial,
    shop_prices_bootstrap,
    update_admin_expense_entry,
    update_admin_expense_item,
    update_admin_item_category,
    update_inventory_item,
    update_selected_shop_items_display_order,
    update_shop_catalogue_item_allocation,
    update_shop_expense,
    update_shop_expense_order,
    update_shop_status,
)
from app.routers.auth import me, register
from app.services.auth import login_user
from app.routers.catalog import get_item_image as get_catalog_item_image
from app.routers.health import health_check
from app.routers.admin.inventory import (
    allocate_shop_inventory,
    get_admin_inventory_backdate_policy,
    put_admin_inventory_backdate_policy,
)
from app.routers.shop import (
    add_inventory_stock,
    bootstrap,
    checkout,
    preview_checkout,
    record_shop_expense,
    save_daily_prices,
    shop_expense_history,
    shop_expense_items,
    shop_inventory_backdate_policy,
    shop_inventory_movements,
    today_prices,
    transfer_inventory_stock,
    use_inventory_stock,
)
from app.schemas.admin import (
    ItemCategoryCreate,
    ItemCategoryUpdate,
    ItemMetadataUpdate,
    ItemScope,
    PriceStatus,
    ShopCreate,
    ShopItemAllocationBulkCreate,
    ShopItemAllocationUpdate,
    ShopSelectedItemsOrderUpdate,
    ShopStatusUpdate,
)
from app.schemas.auth import LoginRequest, RegisterRequest
from app.schemas.billing import (
    BillCheckoutCommitRequest,
    BillCheckoutRequest,
    BillDetailBatchRequest,
    BillItemInput,
    CheckoutPaymentInput,
)
from app.schemas.expenses import (
    ExpenseEntryCreate,
    ExpenseEntryUpdate,
    ExpenseItemCreate,
    ExpenseItemUpdate,
    ShopExpenseAllocationBulkCreate,
    ShopExpenseAllocationUpdate,
    ShopExpenseItemsOrderUpdate,
)
from app.schemas.inventory import (
    InventoryAddRequest,
    InventoryCategoryCreate as InventoryCategoryCreatePayload,
)
from app.schemas.inventory import (
    InventoryItemCreate as InventoryItemCreatePayload,
)
from app.schemas.inventory import (
    InventoryItemPurchaseRateUpdate,
    InventoryItemUpdate as InventoryItemUpdatePayload,
    InventoryUseRequest,
    ShopInventoryAllocationBulkCreate,
)
from app.schemas.inventory_policy import InventoryBackdatePolicyUpdate
from app.schemas.pricing import DailyPriceCreate, DailyPriceEntry, DailyPriceUpdate
from app.schemas.transfer import InventoryTransferCreate
from app.services.transfer import list_inventory_transfers


async def _read_streaming_response_body(body_iterator: AsyncIterable[bytes | str]) -> bytes:
    chunks: list[bytes] = []
    async for chunk in body_iterator:
        chunks.append(chunk.encode() if isinstance(chunk, str) else chunk)
    return b"".join(chunks)


class BackendApiIntegrationTests(BackendTestCase):
    def test_health_endpoint(self) -> None:
        from unittest.mock import Mock, patch

        from fastapi import Request

        mock_request = Mock(spec=Request)
        mock_request.app.state.database_ready = True
        mock_request.app.state.database_error = None
        import json

        with patch("app.routers.health.redis_health_status", return_value="disabled"), patch(
            "app.routers.health._rustfs_health_status", return_value="disabled"
        ):
            response = self.run_async(health_check(mock_request))
        self.assertEqual(
            json.loads(response.body),
            {
                "status": "ok",
                "database": "connected",
                "redis": "disabled",
                "rustfs": "disabled",
                "error": None,
            },
        )

    def test_auth_endpoints(self) -> None:
        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                registered = await register(
                    RegisterRequest(
                        username="admin",
                        password="password123",
                        confirm_password="password123",
                    ),
                    db,
                )
                self.assertEqual(registered.user.role.value, "tenant_admin")
                self.assertEqual(registered.user.next_screen, "admin_dashboard")
                self.assertTrue(registered.access_token)

                admin_user = session.scalar(
                    select(User).where(User.id == registered.user.id)
                )
                current_session = await me(current_user=admin_user, db=db)
                self.assertEqual(current_session.username, "admin")

                logged_in = await login_user(db, "admin", "password123")
                self.assertEqual(logged_in.user.username, "admin")
                self.assertTrue(logged_in.access_token)

        self.run_async(scenario())

    def test_admin_pdf_report_endpoint_generates_filtered_merged_pdf(self) -> None:
        _actor_a, branch_a = self.run_async(
            self.harness.create_shop_user(username="report-a", shop_name="Report Alpha")
        )
        _actor_b, branch_b = self.run_async(
            self.harness.create_shop_user(username="report-b", shop_name="Report Beta")
        )
        self.run_async(self.harness.create_catalogue_items(("Chicken",)))
        self.run_async(self.harness.create_items_for_shop(branch_a.id, ("Chicken",)))
        self.run_async(self.harness.create_items_for_shop(branch_b.id, ("Duck",)))

        async def scenario() -> None:
            report_date = date(2026, 6, 5)
            created_at = datetime(2026, 6, 5, 10, 0, tzinfo=UTC)
            with self.harness.session_factory() as session:
                chicken = session.scalar(
                    select(Item).where(Item.name == "Chicken", Item.shop_id == branch_a.id)
                )
                catalogue_chicken = session.scalar(
                    select(Item).where(Item.name == "Chicken", Item.shop_id.is_(None))
                )
                duck = session.scalar(select(Item).where(Item.name == "Duck", Item.shop_id == branch_b.id))
                chicken.category = "Poultry"
                catalogue_chicken.category = "Poultry"
                duck.category = "Water Birds"
                for index in range(30):
                    amount = Decimal("100.00") + Decimal(index)
                    catalogue_amount = Decimal("2.00") if index == 0 else Decimal("0.00")
                    bill_total = amount + catalogue_amount
                    bill = Bill(
                        bill_no=f"RPT-{index + 1:03}",
                        shop_id=branch_a.id,
                        total_amount=bill_total,
                        status=BillStatus.PAID,
                        created_at=created_at + timedelta(minutes=index),
                    )
                    session.add(bill)
                    session.flush()
                    bill_rows = [
                        Payment(
                            bill_id=bill.id,
                            cash_amount=bill_total,
                            upi_amount=Decimal("0.00"),
                            total_paid=bill_total,
                            balance=Decimal("0.00"),
                            is_settled=True,
                        ),
                        BillItem(
                            bill_id=bill.id,
                            item_id=chicken.id,
                            item_name="Old Chicken" if index < 15 else chicken.name,
                            item_tamil_name=chicken.tamil_name,
                            item_unit_type=chicken.unit_type,
                            item_base_unit=chicken.base_unit,
                            quantity=Decimal("1.000"),
                            unit=chicken.base_unit,
                            price_per_unit=amount,
                            line_total=amount,
                        ),
                    ]
                    if catalogue_amount:
                        bill_rows.append(
                            BillItem(
                                bill_id=bill.id,
                                item_id=catalogue_chicken.id,
                                item_name="Catalogue Chicken",
                                item_tamil_name=catalogue_chicken.tamil_name,
                                item_unit_type=catalogue_chicken.unit_type,
                                item_base_unit=catalogue_chicken.base_unit,
                                quantity=Decimal("1.000"),
                                unit=catalogue_chicken.base_unit,
                                price_per_unit=catalogue_amount,
                                line_total=catalogue_amount,
                            )
                        )
                    session.add_all(bill_rows)
                beta_bill = Bill(
                    bill_no="RPT-BETA-001",
                    shop_id=branch_b.id,
                    total_amount=Decimal("75.00"),
                    status=BillStatus.PAID,
                    created_at=created_at + timedelta(minutes=45),
                )
                session.add(beta_bill)
                session.flush()
                session.add_all(
                    [
                        Payment(
                            bill_id=beta_bill.id,
                            cash_amount=Decimal("0.00"),
                            upi_amount=Decimal("75.00"),
                            total_paid=Decimal("75.00"),
                            balance=Decimal("0.00"),
                            is_settled=True,
                        ),
                        BillItem(
                            bill_id=beta_bill.id,
                            item_id=duck.id,
                            item_name=duck.name,
                            item_tamil_name=duck.tamil_name,
                            item_unit_type=duck.unit_type,
                            item_base_unit=duck.base_unit,
                            quantity=Decimal("1.000"),
                            unit=duck.base_unit,
                            price_per_unit=Decimal("75.00"),
                            line_total=Decimal("75.00"),
                        ),
                    ]
                )
                session.commit()

                db = AsyncSessionAdapter(session)
                admin_user = await self.harness.create_admin_user()
                response = await admin_report_pdf(
                    sections=["sales", "billing", "items", "inventory"],
                    detail_level="summary",
                    period="range",
                    reference_date=None,
                    range_start_date=report_date,
                    range_end_date=report_date,
                    shop_ids=None,
                    db=db,
                )
                body = await _read_streaming_response_body(response.body_iterator)
                self.assertEqual(response.media_type, "application/pdf")
                self.assertTrue(body.startswith(b"%PDF"))
                self.assertIn(b"Sales", body)
                self.assertIn(b"Billing", body)
                self.assertIn(b"Items", body)
                self.assertIn(b"Inventory", body)
                self.assertIn(b"Report Alpha", body)
                self.assertIn(b"Report Beta", body)
                self.assertIn(b"Rows shown: 25 of 31 bills", body)

                items_response = await admin_report_pdf(
                    sections=["items"],
                    detail_level="full",
                    period="range",
                    reference_date=None,
                    range_start_date=report_date,
                    range_end_date=report_date,
                    shop_ids=None,
                    db=db,
                )
                items_body = await _read_streaming_response_body(items_response.body_iterator)
                self.assertIn(b"Branch", items_body)
                self.assertIn(b"Category", items_body)
                self.assertIn(b"Report Alpha", items_body)
                self.assertIn(b"Report Beta", items_body)
                self.assertIn(b"Poultry", items_body)
                self.assertIn(b"Water Birds", items_body)
                self.assertIn(b"Chicken", items_body)
                self.assertIn(b"Duck", items_body)
                self.assertIn(b"Rows shown: 2 sold item row", items_body)
                self.assertNotIn(b"Old Chicken", items_body)
                self.assertNotIn(b"Catalogue Chicken", items_body)

                full_response = await admin_report_pdf(
                    sections=["billing"],
                    detail_level="full",
                    period="range",
                    reference_date=None,
                    range_start_date=report_date,
                    range_end_date=report_date,
                    shop_ids=[branch_a.id],
                    db=db,
                )
                full_body = await _read_streaming_response_body(full_response.body_iterator)
                self.assertIn(b"Rows shown: 30 of 30 bills", full_body)
                self.assertIn(b"Report Alpha", full_body)
                self.assertNotIn(b"Report Beta", full_body)

        self.run_async(scenario())

    def test_admin_pdf_report_endpoint_validates_sections_and_range(self) -> None:
        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                admin_user = await self.harness.create_admin_user()
                with self.assertRaises(HTTPException) as empty_sections_ctx:
                    await admin_report_pdf(sections=[], db=db)
                self.assertEqual(empty_sections_ctx.exception.status_code, 422)

                with self.assertRaises(HTTPException) as invalid_section_ctx:
                    await admin_report_pdf(sections=["unknown"], db=db)  # type: ignore[list-item]
                self.assertEqual(invalid_section_ctx.exception.status_code, 422)

                with self.assertRaises(HTTPException) as range_ctx:
                    await admin_report_pdf(sections=["sales"], period="range", db=db)
                self.assertEqual(range_ctx.exception.status_code, 422)

        self.run_async(scenario())

    def test_catalogue_item_allocation_controls_shop_visibility(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_catalogue_items(("Chicken",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                admin_user = await self.harness.create_admin_user()
                current_shop = session.scalar(select(Shop).where(Shop.id == shop.id))
                catalogue_chicken = session.scalar(
                    select(Item).where(Item.name == "Chicken", Item.shop_id.is_(None))
                )

                listed_items = (await get_shop_items(current_shop, db)).items
                chicken_row = next(item for item in listed_items if item.id == catalogue_chicken.id)
                self.assertFalse(chicken_row.allocated)
                self.assertFalse(chicken_row.available_for_billing)

                before_bootstrap = await shop_prices_bootstrap(current_shop, db)
                self.assertFalse(before_bootstrap.prices_set)
                self.assertNotIn(
                    catalogue_chicken.id,
                    {item.item_id for item in before_bootstrap.items},
                )

                allocated_item = await allocate_shop_catalogue_item(
                    catalogue_chicken.id, current_shop, db
                )
                self.assertTrue(allocated_item.allocated)
                self.assertFalse(allocated_item.can_delete)
                self.assertTrue(allocated_item.can_deallocate)
                customized_item = await update_shop_catalogue_item_allocation(
                    catalogue_chicken.id,
                    ShopItemAllocationUpdate(
                        display_name="Branch Chicken",
                        tamil_name="கிளை கோழி",
                        is_active=True,
                        custom_attributes={"counter": "front"},
                    ),
                    current_shop,
                    db,
                )
                self.assertEqual(customized_item.name, "Branch Chicken")
                self.assertEqual(customized_item.tamil_name, "கிளை கோழி")
                self.assertEqual(customized_item.custom_attributes["counter"], "front")
                listed_items = (await get_shop_items(current_shop, db)).items
                chicken_row = next(item for item in listed_items if item.id == catalogue_chicken.id)
                self.assertTrue(chicken_row.allocated)
                self.assertTrue(chicken_row.available_for_billing)

                await shop_daily_prices(
                    DailyPriceCreate(
                        entries=[
                            DailyPriceEntry(
                                item_id=catalogue_chicken.id,
                                price_per_unit=Decimal("120.00"),
                            )
                        ]
                    ),
                    current_shop,
                    db,
                )
                after_bootstrap = await shop_prices_bootstrap(current_shop, db)
                self.assertIn(
                    catalogue_chicken.id,
                    {item.item_id for item in after_bootstrap.items},
                )
                chicken_price_item = next(
                    item for item in after_bootstrap.items if item.item_id == catalogue_chicken.id
                )
                self.assertEqual(chicken_price_item.item_name, "Branch Chicken")
                self.assertEqual(chicken_price_item.item_tamil_name, "கிளை கோழி")
                self.assertTrue(after_bootstrap.prices_set)

                deallocated_item = await deallocate_shop_catalogue_item(
                    catalogue_chicken.id, current_shop, db
                )
                self.assertFalse(deallocated_item.allocated)
                self.assertFalse(deallocated_item.can_deallocate)
                listed_items = (await get_shop_items(current_shop, db)).items
                chicken_row = next(item for item in listed_items if item.id == catalogue_chicken.id)
                self.assertFalse(chicken_row.allocated)
                self.assertIsNone(chicken_row.current_price)
                final_bootstrap = await shop_prices_bootstrap(current_shop, db)
                self.assertNotIn(
                    catalogue_chicken.id,
                    {item.item_id for item in final_bootstrap.items},
                )

        self.run_async(scenario())

    def test_bulk_catalogue_item_allocation_is_idempotent(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_catalogue_items(("Chicken", "Duck")))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                admin_user = await self.harness.create_admin_user()
                current_shop = session.scalar(select(Shop).where(Shop.id == shop.id))
                catalogue_items = session.scalars(
                    select(Item).where(
                        Item.name.in_(("Chicken", "Duck")),
                        Item.shop_id.is_(None),
                    )
                ).all()
                item_ids = [item.id for item in catalogue_items]

                bulk_result = await allocate_shop_catalogue_items(
                    ShopItemAllocationBulkCreate(item_ids=item_ids),
                    current_shop,
                    db,
                )
                self.assertEqual(bulk_result.allocated_count, 2)
                self.assertEqual(bulk_result.already_allocated_count, 0)
                self.assertEqual(set(bulk_result.item_ids), set(item_ids))

                listed_items = (
                    await get_shop_items(
                        current_shop,
                        db,
                        scope=ItemScope.GLOBAL,
                        allocated=True,
                    )
                ).items
                self.assertEqual({item.id for item in listed_items}, set(item_ids))

                repeated_result = await allocate_shop_catalogue_items(
                    ShopItemAllocationBulkCreate(item_ids=item_ids),
                    current_shop,
                    db,
                )
                self.assertEqual(repeated_result.allocated_count, 0)
                self.assertEqual(repeated_result.already_allocated_count, 2)
                self.assertEqual(set(repeated_result.item_ids), set(item_ids))

        self.run_async(scenario())

    def test_compact_shop_item_lists_support_import_workflow(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(
            self.harness.create_catalogue_items(("Chicken", "Duck", "Quail"))
        )
        self.run_async(self.harness.create_items_for_shop(shop.id, ("Shop Only",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                admin_user = await self.harness.create_admin_user()
                current_shop = session.scalar(select(Shop).where(Shop.id == shop.id))
                catalogue_items = session.scalars(
                    select(Item).where(
                        Item.name.in_(("Chicken", "Duck", "Quail")),
                        Item.shop_id.is_(None),
                    )
                ).all()
                catalogue_by_name = {item.name: item for item in catalogue_items}

                await allocate_shop_catalogue_items(
                    ShopItemAllocationBulkCreate(item_ids=[catalogue_by_name["Chicken"].id]),
                    current_shop,
                    db,
                )

                selected_rows = await get_selected_shop_item_rows(current_shop, db, limit=10)
                self.assertEqual(
                    {item.name for item in selected_rows.items},
                    {"Chicken", "Shop Only"},
                )
                selected_counts = await get_selected_shop_item_counts(current_shop, db)
                self.assertEqual(selected_counts.all, 2)
                self.assertEqual(selected_counts.catalogue, 1)
                self.assertEqual(selected_counts.shop, 1)

                selected_page = await get_selected_shop_items(current_shop, db, limit=10)
                self.assertEqual(
                    {item.name for item in selected_page.items},
                    {"Chicken", "Shop Only"},
                )
                self.assertEqual(selected_page.total_count, 2)
                self.assertTrue(all(item.allocated for item in selected_page.items))

                selected_search = await get_selected_shop_items(
                    current_shop,
                    db,
                    q="shop only",
                    limit=10,
                )
                self.assertEqual([item.name for item in selected_search.items], ["Shop Only"])

                candidate_rows = await get_shop_item_import_candidate_rows(
                    current_shop,
                    db,
                    limit=1,
                )
                self.assertTrue(candidate_rows.has_more)
                self.assertEqual(len(candidate_rows.items), 1)
                candidate_counts = await get_shop_item_import_candidate_counts(current_shop, db)
                self.assertEqual(candidate_counts.all, 2)
                self.assertEqual(candidate_counts.available, 2)

                candidates = await get_shop_item_import_candidates(
                    current_shop,
                    db,
                    limit=1,
                )
                self.assertEqual(candidates.total_count, 2)
                self.assertTrue(candidates.has_more)
                self.assertEqual(len(candidates.items), 1)

                next_candidates = await get_shop_item_import_candidates(
                    current_shop,
                    db,
                    limit=10,
                    cursor_sort_order=candidates.next_cursor_sort_order,
                    cursor_name=candidates.next_cursor_name,
                    cursor_id=candidates.next_cursor_id,
                )
                self.assertEqual(len(next_candidates.items), 1)
                self.assertEqual(
                    {item.name for item in candidates.items + next_candidates.items},
                    {"Duck", "Quail"},
                )

                duck_search = await get_shop_item_import_candidates(
                    current_shop,
                    db,
                    q="duck",
                    limit=10,
                )
                self.assertEqual([item.name for item in duck_search.items], ["Duck"])

                catalogue_by_name["Duck"].is_active = False
                session.commit()
                active_candidates = await get_shop_item_import_candidates(
                    current_shop,
                    db,
                    limit=10,
                )
                self.assertEqual([item.name for item in active_candidates.items], ["Quail"])

        self.run_async(scenario())

    def test_selected_shop_items_filter_by_category(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                admin_user = await self.harness.create_admin_user()
                current_shop = session.scalar(select(Shop).where(Shop.id == shop.id))
                poultry = await create_admin_item_category(ItemCategoryCreate(name="Order Poultry"), db, admin_user)
                seafood = await create_admin_item_category(ItemCategoryCreate(name="Order Seafood"), db, admin_user)

                chicken = await create_inventory_item(
                    name="Filter Chicken",
                    unit_type=UnitType.WEIGHT,
                    base_unit=BaseUnit.KG,
                    tamil_name="வடிகட்டி கோழி",
                    db=db,
                    current_user=admin_user,
                    is_active=True,
                    custom_attributes="{}",
                    sort_order=10,
                    category_id=poultry.id,
                    image=None,
                )
                prawn = await create_inventory_item(
                    name="Filter Prawn",
                    unit_type=UnitType.WEIGHT,
                    base_unit=BaseUnit.KG,
                    tamil_name="வடிகட்டி இறால்",
                    db=db,
                    current_user=admin_user,
                    is_active=True,
                    custom_attributes="{}",
                    sort_order=20,
                    category_id=seafood.id,
                    image=None,
                )
                loose = await create_inventory_item(
                    name="Filter Loose",
                    unit_type=UnitType.WEIGHT,
                    base_unit=BaseUnit.KG,
                    tamil_name="வடிகட்டி பொது",
                    db=db,
                    current_user=admin_user,
                    is_active=True,
                    custom_attributes="{}",
                    sort_order=30,
                    image=None,
                )
                shop_only = await create_shop_inventory_item(
                    name="Filter Shop Only",
                    unit_type=UnitType.WEIGHT,
                    base_unit=BaseUnit.KG,
                    tamil_name="வடிகட்டி கடை",
                    shop=current_shop,
                    db=db,
                    is_active=True,
                    custom_attributes="{}",
                    sort_order=40,
                    category_id=poultry.id,
                    image=None,
                )
                await allocate_shop_catalogue_items(
                    ShopItemAllocationBulkCreate(
                        item_ids=[chicken.id, prawn.id, loose.id]
                    ),
                    current_shop,
                    db,
                )

                poultry_rows = await get_selected_shop_item_rows(
                    current_shop,
                    db,
                    limit=10,
                    category_id=poultry.id,
                )
                self.assertEqual(
                    {item.id for item in poultry_rows.items},
                    {chicken.id, shop_only.id},
                )
                poultry_counts = await get_selected_shop_item_counts(
                    current_shop,
                    db,
                    category_id=poultry.id,
                )
                self.assertEqual(poultry_counts.all, 2)
                self.assertEqual(poultry_counts.catalogue, 1)
                self.assertEqual(poultry_counts.shop, 1)

                seafood_page = await get_selected_shop_items(
                    current_shop,
                    db,
                    limit=10,
                    category_id=seafood.id,
                )
                self.assertEqual([item.id for item in seafood_page.items], [prawn.id])

                uncategorized_page = await get_selected_shop_items(
                    current_shop,
                    db,
                    limit=10,
                    uncategorized=True,
                )
                self.assertEqual([item.id for item in uncategorized_page.items], [loose.id])

                with self.assertRaises(HTTPException) as conflict_context:
                    await get_selected_shop_items(
                        current_shop,
                        db,
                        limit=10,
                        category_id=poultry.id,
                        uncategorized=True,
                    )
                self.assertEqual(conflict_context.exception.status_code, 422)

        self.run_async(scenario())

    def test_selected_shop_item_order_updates_billing_order(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        _other_actor, other_shop = self.run_async(
            self.harness.create_shop_user(username="ml2")
        )

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                admin_user = await self.harness.create_admin_user()
                current_shop = session.scalar(select(Shop).where(Shop.id == shop.id))
                other_current_shop = session.scalar(select(Shop).where(Shop.id == other_shop.id))

                first = await create_inventory_item(
                    name="Order First",
                    unit_type=UnitType.WEIGHT,
                    base_unit=BaseUnit.KG,
                    tamil_name="வரிசை ஒன்று",
                    db=db,
                    current_user=admin_user,
                    is_active=True,
                    custom_attributes="{}",
                    sort_order=10,
                    image=None,
                )
                second = await create_inventory_item(
                    name="Order Second",
                    unit_type=UnitType.WEIGHT,
                    base_unit=BaseUnit.KG,
                    tamil_name="வரிசை இரண்டு",
                    db=db,
                    current_user=admin_user,
                    is_active=True,
                    custom_attributes="{}",
                    sort_order=20,
                    image=None,
                )
                shop_only = await create_shop_inventory_item(
                    name="Order Shop Only",
                    unit_type=UnitType.WEIGHT,
                    base_unit=BaseUnit.KG,
                    tamil_name="வரிசை கடை",
                    shop=current_shop,
                    db=db,
                    is_active=True,
                    custom_attributes="{}",
                    sort_order=30,
                    image=None,
                )
                foreign_item = await create_shop_inventory_item(
                    name="Order Foreign",
                    unit_type=UnitType.WEIGHT,
                    base_unit=BaseUnit.KG,
                    tamil_name="வரிசை வேறு",
                    shop=other_current_shop,
                    db=db,
                    is_active=True,
                    custom_attributes="{}",
                    sort_order=40,
                    image=None,
                )
                await allocate_shop_catalogue_items(
                    ShopItemAllocationBulkCreate(item_ids=[first.id, second.id]),
                    current_shop,
                    db,
                )

                item_order = [shop_only.id, second.id, first.id]
                result = await update_selected_shop_items_display_order(
                    ShopSelectedItemsOrderUpdate(item_ids=item_order),
                    current_shop,
                    db,
                )
                self.assertEqual(result.item_ids, item_order)

                selected_page = await get_selected_shop_items(current_shop, db, limit=10)
                self.assertEqual([item.id for item in selected_page.items], item_order)
                self.assertEqual([item.sort_order for item in selected_page.items], [10, 20, 30])

                admin_bootstrap = await shop_prices_bootstrap(current_shop, db)
                self.assertEqual(
                    [item.item_id for item in admin_bootstrap.items],
                    item_order,
                )
                shop_bootstrap = await bootstrap(current_shop, db)
                self.assertEqual(
                    [item.item_id for item in shop_bootstrap.items],
                    item_order,
                )

                with self.assertRaises(HTTPException) as duplicate_context:
                    await update_selected_shop_items_display_order(
                        ShopSelectedItemsOrderUpdate(
                            item_ids=[shop_only.id, second.id, second.id]
                        ),
                        current_shop,
                        db,
                    )
                self.assertEqual(duplicate_context.exception.status_code, 422)

                with self.assertRaises(HTTPException) as missing_context:
                    await update_selected_shop_items_display_order(
                        ShopSelectedItemsOrderUpdate(item_ids=[shop_only.id, second.id]),
                        current_shop,
                        db,
                    )
                self.assertEqual(missing_context.exception.status_code, 422)

                with self.assertRaises(HTTPException) as foreign_context:
                    await update_selected_shop_items_display_order(
                        ShopSelectedItemsOrderUpdate(
                            item_ids=[shop_only.id, second.id, foreign_item.id]
                        ),
                        current_shop,
                        db,
                    )
                self.assertEqual(foreign_context.exception.status_code, 422)

        self.run_async(scenario())

    def test_independent_expenses_support_allocation_order_and_history(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        _other_actor, other_shop = self.run_async(
            self.harness.create_shop_user(username="expense-other", shop_name="Other Branch")
        )

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                admin_user = await self.harness.create_admin_user()
                current_shop = session.scalar(select(Shop).where(Shop.id == shop.id))
                other_current_shop = session.scalar(select(Shop).where(Shop.id == other_shop.id))

                session.add(
                    Item(
                        organization_id=current_shop.organization_id,
                        name="Tea Expense",
                        tamil_name="பில் தேநீர்",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        sort_order=5,
                        is_active=True,
                    )
                )
                session.commit()

                tea = await create_admin_expense_item(
                    ExpenseItemCreate(
                        name="Tea Expense",
                        tamil_name="தேநீர் செலவு",
                        sort_order=20,
                    ),
                    db,
                )
                fuel = await create_admin_expense_item(
                    ExpenseItemCreate(
                        name="Fuel Expense",
                        tamil_name="எரிபொருள் செலவு",
                        sort_order=10,
                    ),
                    db,
                )
                self.assertIsNotNone(session.scalar(select(ExpenseItem).where(ExpenseItem.id == tea.id)))

                with self.assertRaises(HTTPException) as duplicate_context:
                    await create_admin_expense_item(
                        ExpenseItemCreate(name="tea expense", tamil_name="மறு செலவு"),
                        db,
                    )
                self.assertEqual(duplicate_context.exception.status_code, 409)

                updated_tea = await update_admin_expense_item(
                    tea.id,
                    ExpenseItemUpdate(
                        name="Tea Expense",
                        tamil_name="தேநீர் செலவு",
                        sort_order=30,
                        is_active=True,
                    ),
                    db,
                )
                self.assertEqual(updated_tea.name, "Tea Expense")

                item_rows = await get_expense_items(db, limit=10)
                self.assertEqual({item.name for item in item_rows.items}, {"Fuel Expense", "Tea Expense"})
                item_counts = await get_expense_item_counts(db)
                self.assertEqual(item_counts.all, 2)
                self.assertEqual(item_counts.active, 2)

                bulk_result = await allocate_shop_expenses(
                    ShopExpenseAllocationBulkCreate(expense_item_ids=[fuel.id, tea.id]),
                    current_shop,
                    db,
                )
                self.assertEqual(bulk_result.allocated_count, 2)
                self.assertEqual(bulk_result.already_allocated_count, 0)

                selected_rows = await get_shop_expense_items(current_shop, db, limit=10)
                self.assertEqual([item.id for item in selected_rows.items], [fuel.id, tea.id])

                candidates = await get_shop_expense_item_candidates(current_shop, db, limit=10)
                self.assertNotIn(tea.id, {item.id for item in candidates.items})

                order_result = await update_shop_expense_order(
                    ShopExpenseItemsOrderUpdate(expense_item_ids=[tea.id, fuel.id]),
                    current_shop,
                    db,
                )
                self.assertEqual(order_result.expense_item_ids, [tea.id, fuel.id])
                shop_rows = await shop_expense_items(
                    q=None,
                    cursor_sort_order=None,
                    cursor_name=None,
                    cursor_id=None,
                    shop=current_shop,
                    db=db,
                    limit=10,
                )
                self.assertEqual([item.id for item in shop_rows.items], [tea.id, fuel.id])

                with self.assertRaises(HTTPException) as missing_order_context:
                    await update_shop_expense_order(
                        ShopExpenseItemsOrderUpdate(expense_item_ids=[tea.id]),
                        current_shop,
                        db,
                    )
                self.assertEqual(missing_order_context.exception.status_code, 422)

                paused_fuel = await update_shop_expense(
                    fuel.id,
                    ShopExpenseAllocationUpdate(is_active=False),
                    current_shop,
                    db,
                )
                self.assertFalse(paused_fuel.allocation_is_active)
                visible_shop_rows = await shop_expense_items(
                    q=None,
                    cursor_sort_order=None,
                    cursor_name=None,
                    cursor_id=None,
                    shop=current_shop,
                    db=db,
                    limit=10,
                )
                self.assertEqual([item.id for item in visible_shop_rows.items], [tea.id])

                expense_day = date(2026, 1, 15)
                entry = await record_shop_expense(
                    ExpenseEntryCreate(
                        expense_item_id=tea.id,
                        amount=Decimal("123.45"),
                        spent_at=datetime(2026, 1, 15, 10, 30, tzinfo=UTC),
                        note="Tea purchase",
                    ),
                    current_shop,
                    db,
                )
                older_entry = await record_shop_expense(
                    ExpenseEntryCreate(
                        expense_item_id=tea.id,
                        amount=Decimal("20.00"),
                        spent_at=datetime(2026, 1, 14, 9, 15, tzinfo=UTC),
                        note="Previous tea purchase",
                    ),
                    current_shop,
                    db,
                )
                self.assertEqual(entry.shop_id, current_shop.id)
                self.assertEqual(entry.expense_name, "Tea Expense")
                self.assertEqual(entry.amount, Decimal("123.45"))

                with self.assertRaises(HTTPException) as inactive_context:
                    await record_shop_expense(
                        ExpenseEntryCreate(expense_item_id=fuel.id, amount=Decimal("50.00")),
                        current_shop,
                        db,
                    )
                self.assertEqual(inactive_context.exception.status_code, 409)

                with self.assertRaises(HTTPException) as unallocated_context:
                    await record_shop_expense(
                        ExpenseEntryCreate(expense_item_id=tea.id, amount=Decimal("50.00")),
                        other_current_shop,
                        db,
                    )
                self.assertEqual(unallocated_context.exception.status_code, 409)

                shop_history = await shop_expense_history(
                    range_start_date=None,
                    range_end_date=None,
                    cursor_spent_at=None,
                    cursor_id=None,
                    shop=current_shop,
                    db=db,
                    limit=10,
                )
                self.assertEqual([item.id for item in shop_history.items], [entry.id, older_entry.id])
                self.assertEqual(shop_history.total_amount, Decimal("143.45"))

                dated_history = await shop_expense_history(
                    range_start_date=expense_day,
                    range_end_date=expense_day,
                    cursor_spent_at=None,
                    cursor_id=None,
                    shop=current_shop,
                    db=db,
                    limit=10,
                )
                self.assertEqual([item.id for item in dated_history.items], [entry.id])
                self.assertEqual(dated_history.total_amount, Decimal("123.45"))

                first_page = await shop_expense_history(
                    range_start_date=None,
                    range_end_date=None,
                    cursor_spent_at=None,
                    cursor_id=None,
                    shop=current_shop,
                    db=db,
                    limit=1,
                )
                self.assertEqual([item.id for item in first_page.items], [entry.id])
                self.assertTrue(first_page.has_more)
                self.assertEqual(first_page.total_amount, Decimal("143.45"))
                next_page = await shop_expense_history(
                    range_start_date=None,
                    range_end_date=None,
                    cursor_spent_at=first_page.next_cursor_spent_at,
                    cursor_id=first_page.next_cursor_id,
                    shop=current_shop,
                    db=db,
                    limit=1,
                )
                self.assertEqual([item.id for item in next_page.items], [older_entry.id])
                self.assertEqual(next_page.total_amount, Decimal("143.45"))
                admin_history = await get_expense_history(db, shop_id=current_shop.id, limit=10)
                self.assertEqual([item.id for item in admin_history.items], [entry.id, older_entry.id])
                self.assertEqual(admin_history.items[0].note, "Tea purchase")
                self.assertEqual(admin_history.total_amount, Decimal("143.45"))

                updated_entry = await update_admin_expense_entry(
                    entry.id,
                    ExpenseEntryUpdate(
                        amount=Decimal("150.00"),
                        spent_at=datetime(2026, 1, 15, 11, 0, tzinfo=UTC),
                        note="Corrected tea purchase",
                    ),
                    db,
                )
                self.assertEqual(updated_entry.amount, Decimal("150.00"))
                self.assertEqual(updated_entry.note, "Corrected tea purchase")

                corrected_history = await get_expense_history(db, shop_id=current_shop.id, limit=10)
                self.assertEqual(corrected_history.items[0].id, entry.id)
                self.assertEqual(corrected_history.total_amount, Decimal("170.00"))

        self.run_async(scenario())

    def test_catalogue_row_and_count_endpoints_are_split(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(
            self.harness.create_catalogue_items(("Chicken", "Duck", "Quail"))
        )

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                admin_user = await self.harness.create_admin_user()
                current_shop = session.scalar(select(Shop).where(Shop.id == shop.id))
                catalogue_items = session.scalars(
                    select(Item).where(
                        Item.name.in_(("Chicken", "Duck", "Quail")),
                        Item.shop_id.is_(None),
                    )
                ).all()
                catalogue_by_name = {item.name: item for item in catalogue_items}
                catalogue_by_name["Duck"].is_active = False
                session.commit()

                await allocate_shop_catalogue_items(
                    ShopItemAllocationBulkCreate(item_ids=[catalogue_by_name["Chicken"].id]),
                    current_shop,
                    db,
                )

                first_page = await get_catalogue_item_rows(db, admin_user, limit=1)
                self.assertEqual(len(first_page.items), 1)
                self.assertTrue(first_page.has_more)
                self.assertFalse(first_page.items[0].allocated)
                self.assertEqual(first_page.items[0].bill_count, 0)

                next_page = await get_catalogue_item_rows(
                    db,
                    admin_user,
                    limit=10,
                    cursor_sort_order=first_page.next_cursor_sort_order,
                    cursor_name=first_page.next_cursor_name,
                    cursor_id=first_page.next_cursor_id,
                )
                self.assertEqual(
                    {item.name for item in first_page.items + next_page.items},
                    {"Chicken", "Duck", "Quail"},
                )

                search_page = await get_catalogue_item_rows(db, admin_user, q="qua", limit=10)
                self.assertEqual([item.name for item in search_page.items], ["Quail"])

                counts = await get_catalogue_item_counts(db, admin_user)
                self.assertEqual(counts.all, 3)
                self.assertEqual(counts.allocated, 1)
                self.assertEqual(counts.available, 2)
                self.assertEqual(counts.paused, 1)

        self.run_async(scenario())

    def test_bulk_catalogue_item_allocation_rejects_invalid_items(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_catalogue_items(("Chicken",)))
        self.run_async(self.harness.create_items_for_shop(shop.id, ("Shop Only",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                admin_user = await self.harness.create_admin_user()
                current_shop = session.scalar(select(Shop).where(Shop.id == shop.id))
                inactive_item = session.scalar(
                    select(Item).where(Item.name == "Chicken", Item.shop_id.is_(None))
                )
                inactive_item.is_active = False
                shop_item = session.scalar(
                    select(Item).where(Item.name == "Shop Only", Item.shop_id == shop.id)
                )
                session.commit()

                with self.assertRaises(HTTPException) as inactive_context:
                    await allocate_shop_catalogue_items(
                        ShopItemAllocationBulkCreate(item_ids=[inactive_item.id]),
                        current_shop,
                        db,
                    )
                self.assertEqual(inactive_context.exception.status_code, 422)
                self.assertEqual(
                    inactive_context.exception.detail,
                    "Inactive catalogue items cannot be allocated to a shop",
                )

                with self.assertRaises(HTTPException) as shop_item_context:
                    await allocate_shop_catalogue_items(
                        ShopItemAllocationBulkCreate(item_ids=[shop_item.id]),
                        current_shop,
                        db,
                    )
                self.assertEqual(shop_item_context.exception.status_code, 422)
                self.assertEqual(
                    shop_item_context.exception.detail,
                    "Only catalogue items can be allocated to a shop",
                )

                with self.assertRaises(HTTPException) as missing_context:
                    await allocate_shop_catalogue_items(
                        ShopItemAllocationBulkCreate(item_ids=[uuid7()]),
                        current_shop,
                        db,
                    )
                self.assertEqual(missing_context.exception.status_code, 404)
                self.assertEqual(missing_context.exception.detail, "Item not found")

        self.run_async(scenario())

    def test_shop_items_support_pagination_search_and_custom_attributes(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_catalogue_items(("Chicken", "Duck")))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                admin_user = await self.harness.create_admin_user()
                current_shop = session.scalar(select(Shop).where(Shop.id == shop.id))

                created_item = await create_inventory_item(
                    name="Special Chicken",
                    unit_type=UnitType.WEIGHT,
                    base_unit=BaseUnit.KG,
                    tamil_name="சிறப்பு கோழி",
                    db=db,
                    current_user=admin_user,
                    is_active=True,
                    custom_attributes='{"grade":"A","cut":"curry"}',
                    image=None,
                )
                self.assertEqual(created_item.custom_attributes["grade"], "A")

                first_page = await get_shop_items(current_shop, db, limit=2)
                self.assertEqual(len(first_page.items), 2)
                self.assertTrue(first_page.has_more)
                self.assertIsNotNone(first_page.next_cursor_id)

                second_page = await get_shop_items(
                    current_shop,
                    db,
                    limit=2,
                    cursor_group=first_page.next_cursor_group,
                    cursor_name=first_page.next_cursor_name,
                    cursor_id=first_page.next_cursor_id,
                )
                self.assertNotEqual(
                    {item.id for item in first_page.items},
                    {item.id for item in second_page.items},
                )

                search_page = await get_shop_items(current_shop, db, q="Special", limit=10)
                self.assertEqual([item.id for item in search_page.items], [created_item.id])
                self.assertEqual(search_page.items[0].custom_attributes["cut"], "curry")

                sorted_alpha = await create_inventory_item(
                    name="Sorted Alpha",
                    unit_type=UnitType.WEIGHT,
                    base_unit=BaseUnit.KG,
                    tamil_name="வரிசை அ",
                    db=db,
                    current_user=admin_user,
                    is_active=True,
                    custom_attributes="{}",
                    sort_order=20,
                    image=None,
                )
                sorted_beta = await create_inventory_item(
                    name="Sorted Beta",
                    unit_type=UnitType.WEIGHT,
                    base_unit=BaseUnit.KG,
                    tamil_name="வரிசை ஆ",
                    db=db,
                    current_user=admin_user,
                    is_active=True,
                    custom_attributes="{}",
                    sort_order=10,
                    image=None,
                )
                sorted_first_page = await get_catalogue_items(db, admin_user, q="Sorted", limit=1)
                self.assertEqual([item.id for item in sorted_first_page.items], [sorted_beta.id])
                self.assertEqual(sorted_first_page.next_cursor_sort_order, 10)
                sorted_second_page = await get_catalogue_items(
                    db,
                    admin_user,
                    q="Sorted",
                    limit=1,
                    cursor_sort_order=sorted_first_page.next_cursor_sort_order,
                    cursor_name=sorted_first_page.next_cursor_name,
                    cursor_id=sorted_first_page.next_cursor_id,
                )
                self.assertEqual([item.id for item in sorted_second_page.items], [sorted_alpha.id])

        self.run_async(scenario())

    def test_catalogue_listing_reports_usage_and_image_delete(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                admin_user = await self.harness.create_admin_user()
                current_shop = session.scalar(select(Shop).where(Shop.id == shop.id))

                created_item = await create_inventory_item(
                    name="Catalogue Trial",
                    unit_type=UnitType.WEIGHT,
                    base_unit=BaseUnit.KG,
                    tamil_name="பட்டியல் சோதனை",
                    db=db,
                    current_user=admin_user,
                    is_active=True,
                    custom_attributes="{}",
                    image=None,
                )
                item_row = session.scalar(select(Item).where(Item.id == created_item.id))
                item_row.image_object_key = "items/catalogue-trial.jpg"
                item_row.image_content_type = "image/jpeg"
                session.commit()

                catalogue_page = await get_catalogue_items(db, admin_user, q="Catalogue Trial", limit=10)
                self.assertEqual(catalogue_page.total_count, 1)
                self.assertEqual(catalogue_page.counts.catalogue, 1)
                self.assertEqual(catalogue_page.items[0].id, created_item.id)
                self.assertTrue(catalogue_page.items[0].image_thumb_path.endswith("variant=thumb"))
                self.assertTrue(catalogue_page.items[0].can_delete)
                self.assertFalse(catalogue_page.items[0].allocated)

                await allocate_shop_catalogue_item(created_item.id, current_shop, db)
                allocated_page = await get_catalogue_items(db, admin_user, q="Catalogue Trial", allocated=True, limit=10)
                self.assertEqual(allocated_page.total_count, 1)
                self.assertTrue(allocated_page.items[0].allocated)
                self.assertFalse(allocated_page.items[0].can_delete)
                self.assertFalse(allocated_page.items[0].can_deallocate)
                self.assertEqual(allocated_page.items[0].allocated_shop_count, 1)

                shop_page = await get_shop_items(current_shop, db, q="Catalogue Trial", limit=10)
                self.assertEqual(shop_page.total_count, 1)
                self.assertFalse(shop_page.items[0].can_delete)
                self.assertTrue(shop_page.items[0].can_deallocate)

                with self.assertRaises(HTTPException) as delete_context:
                    await delete_inventory_item(created_item.id, db)
                self.assertEqual(delete_context.exception.status_code, 409)
                self.assertEqual(
                    delete_context.exception.detail,
                    "Cannot delete a catalogue item that is allocated to shops",
                )

                image_result = await delete_inventory_item_image(created_item.id, db)
                self.assertIsNone(image_result.image_path)
                self.assertIsNone(image_result.image_content_type)
                session.expire_all()
                refreshed_item = session.scalar(select(Item).where(Item.id == created_item.id))
                self.assertIsNone(refreshed_item.image_object_key)
                self.assertIsNone(refreshed_item.image_content_type)

                item_row.image_object_key = "items/catalogue-trial-replaced.jpg"
                item_row.image_content_type = "image/jpeg"
                session.commit()
                updated_item = await update_inventory_item(
                    item_id=created_item.id,
                    name="Catalogue Trial",
                    unit_type=UnitType.WEIGHT,
                    base_unit=BaseUnit.KG,
                    tamil_name="பட்டியல் சோதனை",
                    db=db,
                    is_active=True,
                    custom_attributes="{}",
                    sort_order=0,
                    category=None,
                    remove_image=True,
                    image=None,
                )
                self.assertIsNone(updated_item.image_path)
                session.expire_all()
                image_removed_item = session.scalar(select(Item).where(Item.id == created_item.id))
                self.assertIsNone(image_removed_item.image_object_key)
                self.assertIsNone(image_removed_item.image_content_type)

        self.run_async(scenario())

    def test_catalogue_image_proxy_uses_cache_headers_and_304(self) -> None:
        self.run_async(self.harness.create_catalogue_items(("Chicken",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                admin_user = await self.harness.create_admin_user()
                chicken = session.scalar(select(Item).where(Item.name == "Chicken"))
                chicken.image_object_key = "items/chicken/original/image.jpg"
                chicken.image_content_type = "image/jpeg"
                session.commit()

                payload = StoredImagePayload(
                    content=b"x" * 2048,
                    content_type="image/jpeg",
                    object_key="items/chicken/thumb/image.jpg",
                    etag='"thumb-etag"',
                    last_modified=datetime(2026, 5, 31, tzinfo=UTC),
                    cache_control="public, max-age=3600",
                )

                async def fake_image_payload(item, *, db=None, variant="original", request_id=None):
                    self.assertEqual(item.id, chicken.id)
                    self.assertEqual(variant, "thumb")
                    return payload

                with patch(
                    "app.routers.catalog.get_item_image_response_payload",
                    fake_image_payload,
                ):
                    request = Mock()
                    request.headers = {}
                    response = await get_catalog_item_image(
                        chicken.id,
                        request,
                        "thumb",
                        db,
                    )
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.headers["etag"], '"thumb-etag"')
                    self.assertEqual(response.headers["cache-control"], "public, max-age=3600")
                    self.assertEqual(response.headers["content-type"], "image/jpeg")
                    self.assertNotIn("content-encoding", response.headers)

                    request.headers = {"if-none-match": '"thumb-etag"'}
                    not_modified = await get_catalog_item_image(
                        chicken.id,
                        request,
                        "thumb",
                        db,
                    )
                    self.assertEqual(not_modified.status_code, 304)
                    self.assertEqual(not_modified.headers["etag"], '"thumb-etag"')

        self.run_async(scenario())

    def test_catalogue_image_proxy_streams_payload_and_closes_body(self) -> None:
        self.run_async(self.harness.create_catalogue_items(("Chicken",)))

        class Body:
            def __init__(self, chunks: list[bytes]) -> None:
                self.chunks = chunks
                self.closed = False

            def read(self, chunk_size: int) -> bytes:
                assert chunk_size > 0
                if not self.chunks:
                    return b""
                return self.chunks.pop(0)

            def close(self) -> None:
                self.closed = True

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                admin_user = await self.harness.create_admin_user()
                chicken = session.scalar(select(Item).where(Item.name == "Chicken"))
                chicken.image_object_key = "items/chicken/original/image.jpg"
                chicken.image_content_type = "image/jpeg"
                session.commit()

                body = Body([b"stream-", b"image"])
                payload = StoredImageStreamPayload(
                    body=body,
                    content_type="image/jpeg",
                    object_key="items/chicken/original/image.jpg",
                    etag='"stream-etag"',
                    last_modified=datetime(2026, 5, 31, tzinfo=UTC),
                    cache_control="public, max-age=3600",
                )

                async def fake_image_payload(item, *, db=None, variant="original", request_id=None):
                    self.assertEqual(item.id, chicken.id)
                    self.assertEqual(variant, "original")
                    return payload

                with patch(
                    "app.routers.catalog.get_item_image_response_payload",
                    fake_image_payload,
                ):
                    request = Mock()
                    request.headers = {}
                    response = await get_catalog_item_image(
                        chicken.id,
                        request,
                        "original",
                        db,
                    )
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.headers["etag"], '"stream-etag"')
                    chunks = []
                    async for chunk in response.body_iterator:
                        chunks.append(chunk)
                    self.assertEqual(b"".join(chunks), b"stream-image")
                    self.assertTrue(body.closed)

                not_modified_body = Body([b"unused"])
                not_modified_payload = StoredImageStreamPayload(
                    body=not_modified_body,
                    content_type="image/jpeg",
                    object_key="items/chicken/original/image.jpg",
                    etag='"stream-etag"',
                    last_modified=datetime(2026, 5, 31, tzinfo=UTC),
                    cache_control="public, max-age=3600",
                )

                async def fake_not_modified_payload(item, *, db=None, variant="original", request_id=None):
                    return not_modified_payload

                with patch(
                    "app.routers.catalog.get_item_image_response_payload",
                    fake_not_modified_payload,
                ):
                    request = Mock()
                    request.headers = {"if-none-match": '"stream-etag"'}
                    response = await get_catalog_item_image(
                        chicken.id,
                        request,
                        "original",
                        db,
                    )
                    self.assertEqual(response.status_code, 304)
                    self.assertTrue(not_modified_body.closed)

        self.run_async(scenario())

    def test_inventory_metadata_and_image_routes_are_split(self) -> None:
        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                admin_user = await self.harness.create_admin_user()
                category = await create_admin_inventory_category(
                    InventoryCategoryCreatePayload(name="Cold Storage"),
                    db,
                )
                created_item = await create_admin_inventory_item_metadata(
                    InventoryItemCreatePayload(
                        name="Freezer Pack",
                        tamil_name="குளிர் பொதி",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        sort_order=5,
                        category_ids=[],
                    ),
                    db,
                )

                self.assertEqual(created_item.name, "Freezer Pack")
                self.assertEqual(created_item.category_ids, [])
                self.assertEqual(created_item.sort_order, 5)
                self.assertIsNone(created_item.image_path)

                updated_item = await patch_admin_inventory_item_metadata(
                    created_item.id,
                    InventoryItemUpdatePayload(
                        name="Freezer Pack Large",
                        tamil_name="பெரிய குளிர் பொதி",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        sort_order=created_item.sort_order,
                        category_ids=[category.id],
                    ),
                    db,
                )
                self.assertEqual(updated_item.name, "Freezer Pack Large")
                self.assertEqual(updated_item.image_path, created_item.image_path)

                with self.assertRaises(HTTPException) as duplicate_context:
                    await create_admin_inventory_item_metadata(
                        InventoryItemCreatePayload(
                            name="freezer pack large",
                            tamil_name="நகல் குளிர் பொதி",
                            unit_type=UnitType.WEIGHT,
                            base_unit=BaseUnit.KG,
                            category_ids=[category.id],
                        ),
                        db,
                    )
                self.assertEqual(duplicate_context.exception.status_code, 409)

                image_result = await delete_admin_inventory_item_image(updated_item.id, db)
                self.assertEqual(image_result.inventory_item_id, updated_item.id)
                self.assertIsNone(image_result.image_path)
                self.assertIsNone(image_result.image_content_type)

        self.run_async(scenario())

    def test_inventory_item_purchase_rate_can_be_updated(self) -> None:
        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                admin_user = await self.harness.create_admin_user()
                created_item = await create_admin_inventory_item_metadata(
                    InventoryItemCreatePayload(
                        name="Chicken Whole",
                        tamil_name="முழு கோழி",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        sort_order=1,
                        category_ids=[],
                    ),
                    db,
                )
                self.assertEqual(str(created_item.purchase_rate), "0.00")

                updated_item = await patch_admin_inventory_item_purchase_rate(
                    created_item.id,
                    InventoryItemPurchaseRateUpdate(purchase_rate=Decimal("285.50")),
                    db,
                )
                self.assertEqual(str(updated_item.purchase_rate), "285.50")

        self.run_async(scenario())

    def test_inventory_item_purchase_rates_can_be_confirmed_for_today(self) -> None:
        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                admin_user = await self.harness.create_admin_user()
                created_item = await create_admin_inventory_item_metadata(
                    InventoryItemCreatePayload(
                        name="Mutton Curry Cut",
                        tamil_name="ஆட்டிறைச் சதை",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        sort_order=2,
                        category_ids=[],
                    ),
                    db,
                )
                await patch_admin_inventory_item_purchase_rate(
                    created_item.id,
                    InventoryItemPurchaseRateUpdate(purchase_rate=Decimal("640.00")),
                    db,
                )
                yesterday = datetime.now(UTC) - timedelta(days=1)
                await db.execute(
                    update(InventoryItem)
                    .where(InventoryItem.id == created_item.id)
                    .values(updated_at=yesterday)
                )
                await db.commit()

                result = await confirm_admin_inventory_purchase_rates_today(db)
                self.assertEqual(result.updated_count, 1)

                refreshed = await get_admin_inventory_item(created_item.id, db)
                self.assertEqual(str(refreshed.purchase_rate), "640.00")
                self.assertEqual(
                    refreshed.updated_at.date() if refreshed.updated_at else None,
                    datetime.now(UTC).date(),
                )

        self.run_async(scenario())

    def test_item_categories_can_be_created_and_deleted_from_items(self) -> None:
        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                admin_user = await self.harness.create_admin_user()

                created_category = await create_admin_item_category(
                    ItemCategoryCreate(name="Fresh Cuts"), db, admin_user
                )
                listed_categories = await get_item_categories(db, admin_user)
                self.assertIn(created_category.id, {category.id for category in listed_categories})

                created_item = await create_inventory_item(
                    name="Category Trial",
                    unit_type=UnitType.WEIGHT,
                    base_unit=BaseUnit.KG,
                    tamil_name="வகை சோதனை",
                    db=db,
                    current_user=admin_user,
                    is_active=True,
                    custom_attributes="{}",
                    category_id=created_category.id,
                    image=None,
                )
                detail = await get_catalogue_item_detail(created_item.id, db, admin_user)
                self.assertEqual(detail.category_id, created_category.id)
                self.assertEqual(detail.category, "Fresh Cuts")

                response = await delete_admin_item_category(created_category.id, db, admin_user)
                self.assertEqual(response.status_code, 204)
                session.expire_all()
                cleared_item = session.scalar(select(Item).where(Item.id == created_item.id))
                self.assertIsNone(cleared_item.category_id)
                self.assertIsNone(cleared_item.category)

        self.run_async(scenario())

    def test_item_category_rename_updates_assigned_items(self) -> None:
        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                admin_user = await self.harness.create_admin_user()

                created_category = await create_admin_item_category(
                    ItemCategoryCreate(name="Fresh Cuts"), db, admin_user
                )
                created_item = await create_inventory_item(
                    name="Rename Category Trial",
                    unit_type=UnitType.WEIGHT,
                    base_unit=BaseUnit.KG,
                    tamil_name="வகை பெயர் சோதனை",
                    db=db,
                    current_user=admin_user,
                    is_active=True,
                    custom_attributes="{}",
                    category_id=created_category.id,
                    image=None,
                )

                renamed_category = await update_admin_item_category(
                    created_category.id,
                    ItemCategoryUpdate(name="Premium Cuts"),
                    db,
                    admin_user,
                )
                self.assertEqual(renamed_category.name, "Premium Cuts")

                listed_categories = await get_item_categories(db, admin_user)
                listed_category = next(category for category in listed_categories if category.id == created_category.id)
                self.assertEqual(listed_category.name, "Premium Cuts")

                detail = await get_catalogue_item_detail(created_item.id, db, admin_user)
                self.assertEqual(detail.category_id, created_category.id)
                self.assertEqual(detail.category, "Premium Cuts")

        self.run_async(scenario())

    def test_item_category_rename_rejects_duplicate_and_missing_category(self) -> None:
        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                admin_user = await self.harness.create_admin_user()

                first_category = await create_admin_item_category(
                    ItemCategoryCreate(name="Seafood"), db, admin_user
                )
                second_category = await create_admin_item_category(
                    ItemCategoryCreate(name="Poultry"), db, admin_user
                )

                with self.assertRaises(HTTPException) as duplicate_context:
                    await update_admin_item_category(
                        second_category.id,
                        ItemCategoryUpdate(name=first_category.name.lower()),
                        db,
                        admin_user,
                    )
                self.assertEqual(duplicate_context.exception.status_code, 409)

                with self.assertRaises(HTTPException) as missing_context:
                    await update_admin_item_category(
                        uuid7(),
                        ItemCategoryUpdate(name="Missing Category"),
                        db,
                        admin_user,
                    )
                self.assertEqual(missing_context.exception.status_code, 404)

        self.run_async(scenario())

    def test_item_metadata_noop_update_skips_change_event(self) -> None:
        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                admin_user = await self.harness.create_admin_user()

                created_item = await create_inventory_item(
                    name="Noop Metadata Trial",
                    unit_type=UnitType.WEIGHT,
                    base_unit=BaseUnit.KG,
                    tamil_name="மாற்றமில்லை சோதனை",
                    db=db,
                    current_user=admin_user,
                    is_active=True,
                    custom_attributes='{"grade":"A"}',
                    sort_order=7,
                    category=None,
                    image=None,
                )
                before_events = session.scalars(select(ItemChangeEvent)).all()

                result = await patch_inventory_item_metadata(
                    created_item.id,
                    ItemMetadataUpdate(
                        name="Noop Metadata Trial",
                        tamil_name="மாற்றமில்லை சோதனை",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        is_active=True,
                        sort_order=7,
                        category_id=None,
                        category=None,
                        custom_attributes={"grade": "A"},
                    ),
                    db,
                )

                after_events = session.scalars(select(ItemChangeEvent)).all()
                self.assertEqual(result.id, created_item.id)
                self.assertEqual(len(after_events), len(before_events))

        self.run_async(scenario())

    def test_shop_item_price_status_distinguishes_stale_prices(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())

        async def scenario() -> None:
            yesterday = date.today() - timedelta(days=1)
            await self.harness.create_prices_for_shop(
                shop.id,
                yesterday,
                {"Chicken": "99.00"},
            )

            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                admin_user = await self.harness.create_admin_user()
                current_shop = session.scalar(select(Shop).where(Shop.id == shop.id))
                chicken = session.scalar(select(Item).where(Item.name == "Chicken", Item.shop_id == shop.id))

                shop_items = await get_shop_items(current_shop, db, priced=False, limit=10)
                chicken_row = next(item for item in shop_items.items if item.id == chicken.id)
                self.assertEqual(chicken_row.price_status, PriceStatus.STALE)
                self.assertEqual(chicken_row.latest_price_date, yesterday)
                self.assertFalse(chicken_row.can_delete)

                stale_items = await get_shop_items(
                    current_shop, db, price_status=PriceStatus.STALE, limit=10
                )
                self.assertIn(chicken.id, {item.id for item in stale_items.items})
                missing_items = await get_shop_items(
                    current_shop, db, price_status=PriceStatus.MISSING, limit=10
                )
                self.assertNotIn(chicken.id, {item.id for item in missing_items.items})

                bootstrap_response = await shop_prices_bootstrap(current_shop, db)
                bootstrap_item = next(item for item in bootstrap_response.items if item.item_id == chicken.id)
                self.assertEqual(bootstrap_item.price_status, PriceStatus.STALE)
                self.assertFalse(bootstrap_response.prices_set)

        self.run_async(scenario())

    def test_partial_shop_price_save_and_zero_price_rejection(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())

        async def scenario() -> None:
            await self.harness.create_items_for_shop(shop.id, ("Chicken", "Duck"))
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                admin_user = await self.harness.create_admin_user()
                current_shop = session.scalar(select(Shop).where(Shop.id == shop.id))
                items = session.scalars(
                    select(Item).where(Item.shop_id == shop.id).order_by(Item.name)
                ).all()
                chicken = next(item for item in items if item.name == "Chicken")
                duck = next(item for item in items if item.name == "Duck")

                partial_prices = await shop_daily_prices_partial(
                    DailyPriceCreate(
                        entries=[
                            DailyPriceEntry(
                                item_id=chicken.id,
                                price_per_unit=Decimal("111.00"),
                            )
                        ]
                    ),
                    current_shop,
                    db,
                )
                self.assertEqual(len(partial_prices), 1)
                self.assertEqual(
                    session.scalar(select(DailyPrice).where(DailyPrice.item_id == duck.id)),
                    None,
                )

                with self.assertRaises(HTTPException) as context:
                    await shop_daily_prices(
                        DailyPriceCreate.model_construct(
                            entries=[
                                DailyPriceEntry(
                                    item_id=chicken.id,
                                    price_per_unit=Decimal("111.00"),
                                ),
                                DailyPriceEntry.model_construct(
                                    item_id=duck.id,
                                    price_per_unit=Decimal("0.00"),
                                ),
                            ]
                        ),
                        current_shop,
                        db,
                    )
                self.assertEqual(context.exception.status_code, 422)
                self.assertEqual(context.exception.detail, "Prices must be greater than 0")

                bootstrap_response = await shop_prices_bootstrap(current_shop, db)
                self.assertFalse(bootstrap_response.prices_set)

        self.run_async(scenario())

    def test_item_detail_endpoints_and_row_price_save(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_catalogue_items(("Chicken",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                admin_user = await self.harness.create_admin_user()
                current_shop = session.scalar(select(Shop).where(Shop.id == shop.id))
                catalogue_chicken = session.scalar(
                    select(Item).where(Item.name == "Chicken", Item.shop_id.is_(None))
                )

                catalogue_detail = await get_catalogue_item_detail(catalogue_chicken.id, db, admin_user)
                self.assertEqual(catalogue_detail.id, catalogue_chicken.id)
                self.assertEqual(catalogue_detail.scope, ItemScope.GLOBAL)
                self.assertEqual(catalogue_detail.allocated_shop_count, 0)

                await allocate_shop_catalogue_item(catalogue_chicken.id, current_shop, db)
                shop_detail = await get_shop_item_detail(catalogue_chicken.id, current_shop, db)
                self.assertTrue(shop_detail.allocated)
                self.assertEqual(shop_detail.price_status, PriceStatus.MISSING)

                saved_price = await shop_daily_price(
                    catalogue_chicken.id,
                    DailyPriceUpdate(price_per_unit=Decimal("125.50")),
                    current_shop,
                    db,
                )
                self.assertEqual(saved_price.item_id, catalogue_chicken.id)
                self.assertEqual(saved_price.price_per_unit, Decimal("125.50"))

                current_items = await get_shop_items(
                    current_shop, db, price_status=PriceStatus.CURRENT, limit=10
                )
                self.assertIn(catalogue_chicken.id, {item.id for item in current_items.items})
                refreshed_detail = await get_shop_item_detail(catalogue_chicken.id, current_shop, db)
                self.assertEqual(refreshed_detail.price_status, PriceStatus.CURRENT)
                self.assertEqual(refreshed_detail.current_price, Decimal("125.50"))

        self.run_async(scenario())

    def test_bulk_shop_prices_still_require_complete_setup(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())

        async def scenario() -> None:
            await self.harness.create_items_for_shop(shop.id, ("Chicken", "Duck"))
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                admin_user = await self.harness.create_admin_user()
                current_shop = session.scalar(select(Shop).where(Shop.id == shop.id))
                items = session.scalars(
                    select(Item).where(Item.shop_id == shop.id).order_by(Item.name)
                ).all()
                self.assertGreaterEqual(len(items), 2)

                with self.assertRaises(HTTPException) as context:
                    await shop_daily_prices(
                        DailyPriceCreate(
                            entries=[
                                DailyPriceEntry(
                                    item_id=items[0].id,
                                    price_per_unit=Decimal("100.00"),
                                )
                            ]
                        ),
                        current_shop,
                        db,
                    )
                self.assertEqual(context.exception.status_code, 422)
                self.assertEqual(context.exception.detail, "Prices must be provided for every active item")

        self.run_async(scenario())

    def test_bill_detail_uses_item_snapshots_after_item_rename(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())

        async def scenario() -> None:
            await self.harness.create_items_for_shop(shop.id, ("Chicken",))
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                admin_user = await self.harness.create_admin_user()
                current_shop = session.scalar(select(Shop).where(Shop.id == shop.id))
                chicken = session.scalar(select(Item).where(Item.name == "Chicken", Item.shop_id == shop.id))

                await shop_daily_prices(
                    DailyPriceCreate(
                        entries=[
                            DailyPriceEntry(
                                item_id=chicken.id,
                                price_per_unit=Decimal("120.00"),
                            )
                        ]
                    ),
                    current_shop,
                    db,
                )
                checkout_payload = BillCheckoutRequest(
                    items=[BillItemInput(item_id=chicken.id, quantity=Decimal("1"))],
                    payment=CheckoutPaymentInput(
                        cash_amount=Decimal("120.00"),
                        upi_amount=Decimal("0.00"),
                    ),
                )
                bill_preview = await preview_checkout(checkout_payload, db, current_shop)
                created_bill = await checkout(
                    BillCheckoutCommitRequest(
                        items=checkout_payload.items,
                        payment=checkout_payload.payment,
                        checkout_token=bill_preview.checkout_token,
                    ),
                    db,
                    current_shop,
                )
                second_preview = await preview_checkout(checkout_payload, db, current_shop)
                second_bill = await checkout(
                    BillCheckoutCommitRequest(
                        items=checkout_payload.items,
                        payment=checkout_payload.payment,
                        checkout_token=second_preview.checkout_token,
                    ),
                    db,
                    current_shop,
                )

                chicken.name = "Renamed Chicken"
                chicken.tamil_name = "மாற்றிய பெயர்"
                session.commit()

                historical_bill = await bill_detail(created_bill.id, db)
                self.assertEqual(historical_bill.items[0].item_name, "Chicken")
                self.assertEqual(historical_bill.items[0].item_tamil_name, "தோலுடன்")
                self.assertEqual(historical_bill.items[0].item_unit_type, UnitType.WEIGHT)
                self.assertEqual(historical_bill.items[0].item_base_unit, BaseUnit.KG)

                batch = await bill_details(
                    BillDetailBatchRequest(bill_ids=[second_bill.id, created_bill.id]),
                    db,
                )
                self.assertEqual([bill.id for bill in batch], [second_bill.id, created_bill.id])
                self.assertEqual(batch[1].items[0].item_name, "Chicken")

                with self.assertRaises(HTTPException) as missing_ctx:
                    await bill_details(
                        BillDetailBatchRequest(bill_ids=[created_bill.id, uuid7()]),
                        db,
                    )
                self.assertEqual(missing_ctx.exception.status_code, 404)

                with self.assertRaises(ValidationError):
                    BillDetailBatchRequest(bill_ids=[uuid7() for _ in range(51)])

        self.run_async(scenario())

    def test_admin_and_shop_api_flow(self) -> None:
        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)

                registered_admin = await register(
                    RegisterRequest(
                        username="admin",
                        password="password123",
                        confirm_password="password123",
                    ),
                    db,
                )
                admin_user = session.scalar(
                    select(User).where(User.id == registered_admin.user.id)
                )

                created_shop = await create_shop(
                    ShopCreate(name="Main Shop", username="ml1", password="password"),
                    db,
                    admin_user,
                )
                self.assertEqual(created_shop.username, "ml1")
                shop_id = created_shop.id

                listed_shops = await get_shops(db, admin_user)
                self.assertEqual(len(listed_shops), 1)
                self.assertIsNone(listed_shops[0].last_active_at)

                await self.harness.create_items_for_shop(shop_id, ("Chicken", "Duck"))
                items = session.scalars(
                    select(Item)
                    .where(
                        Item.is_active.is_(True),
                        Item.shop_id == shop_id,
                    )
                    .order_by(Item.id)
                ).all()
                price_payload = DailyPriceCreate(
                    entries=[
                        DailyPriceEntry(
                            item_id=item.id,
                            price_per_unit=Decimal("100.00") + Decimal(index),
                        )
                        for index, item in enumerate(items)
                    ]
                )

                current_shop = session.scalar(select(Shop).where(Shop.id == shop_id))

                admin_shop_bootstrap = await shop_prices_bootstrap(current_shop, db)
                self.assertFalse(admin_shop_bootstrap.prices_set)

                admin_shop_prices = await shop_daily_prices(
                    price_payload, current_shop, db
                )
                self.assertEqual(len(admin_shop_prices), len(items))

                admin_shop_bootstrap = await shop_prices_bootstrap(current_shop, db)
                self.assertTrue(admin_shop_bootstrap.prices_set)

                shop_login = await login_user(db, "ml1", "password")
                self.assertEqual(shop_login.user.next_screen, "billing")

                shop_user = await db.scalar(
                    select(User)
                    .options(selectinload(User.shop))
                    .where(User.id == shop_login.user.id)
                )
                self.assertIsNotNone(shop_user.last_login_at)
                listed_shops = await get_shops(db, admin_user)
                last_active = listed_shops[0].last_active_at
                last_login = shop_user.last_login_at
                if last_active is not None and last_active.tzinfo is None:
                    last_active = last_active.replace(tzinfo=UTC)
                if last_login is not None and last_login.tzinfo is None:
                    last_login = last_login.replace(tzinfo=UTC)
                self.assertEqual(last_active, last_login)
                shop_session = await me(current_user=shop_user, db=db)
                self.assertEqual(shop_session.shop_id, shop_id)

                shop_bootstrap_response = await bootstrap(current_shop, db)
                self.assertTrue(shop_bootstrap_response.prices_set)
                chicken_bootstrap_item = next(
                    item
                    for item in shop_bootstrap_response.items
                    if item.item_name == "Chicken"
                )
                self.assertIsNone(chicken_bootstrap_item.image_path)

                today_price_rows = await today_prices(current_shop, db)
                self.assertEqual(len(today_price_rows), len(items))

                saved_shop_prices = await save_daily_prices(
                    price_payload, db, current_shop
                )
                self.assertEqual(len(saved_shop_prices), len(items))

                refreshed_bootstrap = await bootstrap(current_shop, db)
                self.assertEqual(refreshed_bootstrap.next_screen, "billing")

                duck_item = next(
                    item
                    for item in refreshed_bootstrap.items
                    if item.item_name == "Duck"
                )
                chicken_item = next(
                    item
                    for item in refreshed_bootstrap.items
                    if item.item_name == "Chicken"
                )
                total_amount = (
                    duck_item.current_price + chicken_item.current_price * Decimal("2")
                )

                checkout_payload = BillCheckoutRequest(
                    items=[
                        BillItemInput(
                            item_id=duck_item.item_id, quantity=Decimal("1")
                        ),
                        BillItemInput(
                            item_id=chicken_item.item_id, quantity=Decimal("2")
                        ),
                    ],
                    payment=CheckoutPaymentInput(
                        cash_amount=total_amount,
                        upi_amount=Decimal("0.00"),
                    ),
                )
                bill_preview = await preview_checkout(
                    checkout_payload,
                    db,
                    current_shop,
                )
                created_bill = await checkout(
                    BillCheckoutCommitRequest(
                        items=checkout_payload.items,
                        payment=checkout_payload.payment,
                        checkout_token=bill_preview.checkout_token,
                    ),
                    db,
                    current_shop,
                )
                self.assertEqual(created_bill.status, "paid")
                self.assertTrue(created_bill.payment.is_settled)
                bill_day = created_bill.created_at.date()

                sales_rows = await sales_summary(
                    period="date", reference_date=None, shop_id=None, db=db
                )
                self.assertEqual(sales_rows[0].shop_name, current_shop.name)

                weekly_sales_rows = await sales_summary(
                    period="week", reference_date=None, shop_id=None, db=db
                )
                self.assertEqual(weekly_sales_rows[0].shop_name, current_shop.name)

                yearly_sales_rows = await sales_summary(
                    period="year", reference_date=None, shop_id=None, db=db
                )
                self.assertEqual(yearly_sales_rows[0].shop_name, current_shop.name)

                range_sales_rows = await sales_summary(
                    period="range",
                    reference_date=None,
                    range_start_date=bill_day,
                    range_end_date=bill_day,
                    shop_id=None,
                    db=db,
                )
                self.assertEqual(range_sales_rows[0].total_sales, total_amount)

                payment_rows = await payment_summary(
                    period="date", reference_date=None, shop_id=None, db=db
                )
                self.assertEqual(payment_rows[0].cash_total, total_amount)

                weekly_payment_rows = await payment_summary(
                    period="week", reference_date=None, shop_id=None, db=db
                )
                self.assertEqual(weekly_payment_rows[0].cash_total, total_amount)

                yearly_payment_rows = await payment_summary(
                    period="year", reference_date=None, shop_id=None, db=db
                )
                self.assertEqual(yearly_payment_rows[0].cash_total, total_amount)

                range_payment_rows = await payment_summary(
                    period="range",
                    reference_date=None,
                    range_start_date=bill_day,
                    range_end_date=bill_day,
                    shop_id=None,
                    db=db,
                )
                self.assertEqual(range_payment_rows[0].cash_total, total_amount)

                bill_rows = await bills(
                    period="date",
                    reference_date=None,
                    shop_id=None,
                    limit=50,
                    cursor_created_at=None,
                    cursor_id=None,
                    db=db,
                )
                self.assertEqual(len(bill_rows.items), 1)

                weekly_bill_rows = await bills(
                    period="week",
                    reference_date=None,
                    shop_id=None,
                    limit=50,
                    cursor_created_at=None,
                    cursor_id=None,
                    db=db,
                )
                self.assertEqual(len(weekly_bill_rows.items), 1)

                yearly_bill_rows = await bills(
                    period="year",
                    reference_date=None,
                    shop_id=None,
                    limit=50,
                    cursor_created_at=None,
                    cursor_id=None,
                    db=db,
                )
                self.assertEqual(len(yearly_bill_rows.items), 1)

                range_bill_rows = await bills(
                    period="range",
                    reference_date=None,
                    range_start_date=bill_day,
                    range_end_date=bill_day,
                    shop_id=None,
                    limit=50,
                    cursor_created_at=None,
                    cursor_id=None,
                    db=db,
                )
                self.assertEqual(len(range_bill_rows.items), 1)

                disabled_shop = await update_shop_status(
                    shop_id, ShopStatusUpdate(is_active=False), db, admin_user
                )
                self.assertFalse(disabled_shop.is_active)

        self.run_async(scenario())

    def test_inventory_backdate_policy_endpoints(self) -> None:
        shop_actor, shop = self.run_async(self.harness.create_shop_user())

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                admin_user = await self.harness.create_admin_user()
                current_shop = session.scalar(select(Shop).where(Shop.id == shop.id))
                shop_user = session.scalar(select(User).where(User.id == shop_actor.id))

                category = await create_admin_inventory_category(
                    InventoryCategoryCreatePayload(name="Cold"),
                    db=db,
                )
                item = await create_admin_inventory_item_metadata(
                    InventoryItemCreatePayload(
                        name="Backdate Lamb",
                        tamil_name="ஆட்டு",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[],
                    ),
                    db=db,
                )
                await allocate_shop_inventory(
                    ShopInventoryAllocationBulkCreate(item_ids=[item.id]),
                    shop=current_shop,
                    db=db,
                )

                default_policy = await get_admin_inventory_backdate_policy(db)
                self.assertFalse(default_policy.allow_shop_backdated_inventory)

                shop_policy = await shop_inventory_backdate_policy(db=db, _shop=current_shop)
                self.assertFalse(shop_policy.allow_shop_backdated_inventory)

                yesterday = datetime.now(UTC) - timedelta(days=1)
                with self.assertRaises(HTTPException) as denied:
                    await add_inventory_stock(
                        item.id,
                        InventoryAddRequest(
                            quantity=Decimal("5"),
                            driver_name="Driver",
                            vehicle_number="TN01AB1234",
                            occurred_at=yesterday,
                        ),
                        shop=current_shop,
                        actor=shop_user,
                        db=db,
                    )
                self.assertEqual(denied.exception.status_code, 422)

                updated_policy = await put_admin_inventory_backdate_policy(
                    InventoryBackdatePolicyUpdate(
                        allow_shop_backdated_inventory=True,
                        shop_backdate_window_days=3,
                    ),
                    db=db,
                )
                self.assertTrue(updated_policy.allow_shop_backdated_inventory)

                add_result = await add_inventory_stock(
                    item.id,
                    InventoryAddRequest(
                        quantity=Decimal("5"),
                        driver_name="Driver",
                        vehicle_number="TN01AB1234",
                        occurred_at=yesterday,
                    ),
                    shop=current_shop,
                    actor=shop_user,
                    db=db,
                )
                self.assertEqual(add_result.movement.occurred_at.date(), yesterday.date())

                from app.services.inventory import list_inventory_movements

                history = await list_inventory_movements(
                    db,
                    shop_id=current_shop.id,
                    reference_date=yesterday.date(),
                    limit=30,
                )
                self.assertEqual(len(history.items), 1)

                destination = TransferShop(
                    name="Outside Branch",
                    tamil_name="வெளி கிளை",
                    organization_id=current_shop.organization_id,
                    is_active=True,
                )
                session.add(destination)
                session.flush()

                transfer_result = await transfer_inventory_stock(
                    item.id,
                    InventoryTransferCreate(
                        transfer_shop_id=destination.id,
                        quantity=Decimal("2"),
                        occurred_at=yesterday,
                    ),
                    shop=current_shop,
                    actor=shop_user,
                    db=db,
                )
                self.assertEqual(transfer_result.occurred_at.date(), yesterday.date())

                transfer_history = await list_inventory_transfers(
                    db,
                    source_shop_id=current_shop.id,
                    reference_date=yesterday.date(),
                    limit=30,
                )
                self.assertEqual(len(transfer_history.items), 1)
                self.assertEqual(transfer_history.items[0].id, transfer_result.id)

                with self.assertRaises(HTTPException) as use_denied:
                    await use_inventory_stock(
                        item.id,
                        InventoryUseRequest(quantity=Decimal("10"), occurred_at=yesterday),
                        shop=current_shop,
                        actor=shop_user,
                        db=db,
                    )
                self.assertEqual(use_denied.exception.status_code, 409)

                await add_inventory_stock(
                    item.id,
                    InventoryAddRequest(
                        quantity=Decimal("5"),
                        driver_name="Driver",
                        vehicle_number="TN01AB1234",
                    ),
                    shop=current_shop,
                    actor=admin_user,
                    db=db,
                )

        self.run_async(scenario())
