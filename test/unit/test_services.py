from __future__ import annotations

# ruff: noqa: I001

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from unittest.mock import patch
from uuid import UUID

from test.support import AsyncSessionAdapter, BackendTestCase

from botocore.exceptions import ClientError
from fastapi import HTTPException
from PIL import Image
from pydantic import ValidationError
from sqlalchemy import func, select, text

from app.db import storage as item_storage
from app.db.storage import images as storage_images
from app.db.storage import objects as storage_objects
from app.models import (
    BaseUnit,
    Bill,
    DailyPrice,
    ExpenseEntry,
    ExpenseItem,
    InventoryMovement,
    InventoryMovementType,
    InventoryTransfer,
    Item,
    ItemAssumptionStatus,
    ReceiptStatus,
    Shop,
    TransferShop,
    UnitType,
    User,
)
from app.schemas.admin import (
    ItemAssumptionUpdate,
    ItemCreate,
    OverallReportInventoryItem,
    OverallReportStatement,
    PriceStatus,
    ShopCreate,
)
from app.schemas.auth import RegisterRequest
from app.schemas.billing import (
    BillCheckoutCommitRequest,
    BillCheckoutRequest,
    BillItemInput,
    BillReceiptStatusUpdate,
    CheckoutPaymentInput,
)
from app.schemas.inventory import (
    InventoryAddRequest,
    InventoryBillingItemMappingWrite,
    InventoryCategoryCreate,
    InventoryItemCreate,
    InventoryItemUpdate,
    InventoryUseRequest,
    InventoryUseSplitLine,
    InventoryUseSplitRequest,
)
from app.schemas.retailer_inventory import (
    RetailerInventoryUsageBulkCreate,
    RetailerInventoryUsageLine,
    RetailerStockAdjustRequest,
)
from app.schemas.retailers import RetailerCreate
from app.services.auth import register_admin
from app.services.admin import allocate_catalogue_item, create_shop_account, update_item_assumption
from app.services.admin.shops import create_item
from app.services.retailer_inventory import (
    admin_set_retailer_inventory_stock,
    list_retailer_inventory_usages,
    record_retailer_inventory_usages_bulk,
)
from app.services.retailers import create_retailer, sync_retailer_branch_allocations
from app.services.billing import create_bill, preview_bill, update_bill_receipt_status
from app.services.inventory import (
    add_shop_inventory_stock,
    allocate_shop_inventory_items,
    count_inventory_items,
    create_inventory_category,
    create_inventory_item as create_inventory_management_item,
    delete_inventory_category,
    delete_inventory_item as delete_inventory_management_item,
    get_inventory_summary,
    get_inventory_item,
    list_inventory_item_rows,
    list_inventory_movements,
    list_inventory_stock_rows,
    update_inventory_item as update_inventory_management_item,
    update_shop_inventory_allocation,
    use_shop_inventory_stock,
    use_shop_inventory_stock_split,
)
from app.schemas.pricing import DailyPriceCreate, DailyPriceEntry
from app.services.pricing import (
    create_daily_prices,
    create_global_daily_prices,
    get_global_bootstrap,
    get_shop_bootstrap,
    get_shop_price_history,
)
from app.services.reports import (
    _over_report_sheet_headers,
    _over_report_sheet_rows,
    _over_report_sheet_widths,
    build_overall_report,
    generate_admin_report_pdf,
)
from app.services.reports.pdf import get_over_report_sheet_config


def _square_image_bytes(size: int = 400, image_format: str = "PNG") -> bytes:
    output = BytesIO()
    Image.new("RGB", (size, size), color=(180, 40, 40)).save(output, format=image_format)
    return output.getvalue()


class ServiceUnitTests(BackendTestCase):
    def test_over_report_sheet_widths_fit_header_lines(self) -> None:
        def measure(text: str) -> float:
            return len(text) * 4.0

        for use_tamil in (False, True):
            headers, min_widths, _, _, _, _ = get_over_report_sheet_config(use_tamil=use_tamil)
            rows = [
                [
                    "16/06/2026",
                    "Chicken Stock",
                    "10 Kg\n------------\n8 Count",
                    "5 Kg\n------------\n4 Count",
                    "15 Kg\n------------\n12 Count",
                    "Kitchen Use\n4 Kg\n\nDead\n1 Kg\n------------\n3 Count",
                    "2 Kg\n------------\n1 Count",
                    "-\n------------\n- Count",
                    "11 Kg\n------------\n8 Count",
                    "₹50.00",
                    "₹200.00",
                    "Chicken",
                    "3 Kg",
                    "1 Kg",
                    "2 Kg",
                    "1 Kg",
                    "1 Kg",
                    "₹100.00",
                    "₹50.00",
                    "₹200.00",
                    "₹100.00",
                    "₹100.00",
                ],
            ]
            widths = _over_report_sheet_widths(
                headers,
                line_width=measure,
                available_width=5000,
                min_widths=min_widths,
                rows=rows,
                data_line_width=measure,
            )
            self.assertEqual(len(widths), len(headers))
            for header, width in zip(headers, widths, strict=True):
                for line in header.split("\n"):
                    self.assertLessEqual(measure(line) + 16, width)
            for row in rows:
                for cell, width in zip(row, widths, strict=True):
                    for line in str(cell).split("\n"):
                        if line:
                            self.assertLessEqual(measure(line) + 12, width)

    def test_over_report_single_day_subtotal_rows_match_headers(self) -> None:
        headers = _over_report_sheet_headers(use_tamil=False)
        report_date = date(2026, 6, 1)
        statement = OverallReportStatement(
            shop_id=UUID("018f36ba-7c1f-7c2d-9d67-000000000010"),
            shop_name="SK Nagar",
            start_date=report_date,
            end_date=report_date,
            period_label="2026-06-01",
            inventory_items=[
                OverallReportInventoryItem(
                    inventory_item_id=UUID("018f36ba-7c1f-7c2d-9d67-000000000011"),
                    item_name="Chicken Stock",
                    item_tamil_name="கோழி இருப்பு",
                    category="Chicken",
                    unit=BaseUnit.KG,
                    old_stock=Decimal("10"),
                    adding_stock=Decimal("5"),
                    total_available_stock=Decimal("15"),
                    used_stock=Decimal("4"),
                    transfer_stock=Decimal("2"),
                    remaining_stock=Decimal("9"),
                    sales_quantity=Decimal("3"),
                    assumption_quantity=Decimal("3"),
                    difference_quantity=Decimal("0"),
                    sales_amount=Decimal("300"),
                    assumption_amount=Decimal("300"),
                    difference_amount=Decimal("0"),
                )
            ],
        )

        rows = _over_report_sheet_rows(statement.inventory_items, statement)

        self.assertTrue(rows)
        for row in rows:
            self.assertEqual(len(row), len(headers))
        subtotal_row = rows[-1]
        self.assertEqual(subtotal_row[9], "")
        self.assertEqual(subtotal_row[10], "")
        self.assertEqual(subtotal_row[11], "Subtotal")

    def test_over_report_accounts_for_inventory_transfers(self) -> None:
        _actor, shop = self.run_async(
            self.harness.create_shop_user(shop_name="Transfer Branch")
        )

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.get(Shop, shop.id)
                inventory_item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Transfer Chicken Stock",
                        tamil_name="பரிமாற்ற கோழி இருப்பு",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[],
                        billing_item_ids=[],
                    ),
                )
                await allocate_shop_inventory_items(db, current_shop, [inventory_item.id])
                destination = TransferShop(
                    name="Outside Branch",
                    tamil_name="வெளி கிளை",
                    organization_id=current_shop.organization_id,
                )
                session.add(destination)
                session.flush()

                report_date = date(2026, 6, 1)
                before_period = datetime(2026, 5, 31, 10, tzinfo=UTC)
                in_period = datetime(2026, 6, 1, 10, tzinfo=UTC)
                session.add_all(
                    [
                        InventoryMovement(
                            shop_id=current_shop.id,
                            inventory_item_id=inventory_item.id,
                            movement_type=InventoryMovementType.ADD,
                            quantity=Decimal("20"),
                            created_at=before_period,
                            occurred_at=before_period,
                        ),
                        InventoryMovement(
                            shop_id=current_shop.id,
                            inventory_item_id=inventory_item.id,
                            movement_type=InventoryMovementType.USE,
                            quantity=Decimal("3"),
                            created_at=before_period,
                            occurred_at=before_period,
                        ),
                        InventoryTransfer(
                            source_shop_id=current_shop.id,
                            transfer_shop_id=destination.id,
                            inventory_item_id=inventory_item.id,
                            quantity=Decimal("4"),
                            unit=BaseUnit.KG,
                            created_at=before_period,
                            occurred_at=before_period,
                        ),
                        InventoryMovement(
                            shop_id=current_shop.id,
                            inventory_item_id=inventory_item.id,
                            movement_type=InventoryMovementType.ADD,
                            quantity=Decimal("10"),
                            created_at=in_period,
                            occurred_at=in_period,
                        ),
                        InventoryMovement(
                            shop_id=current_shop.id,
                            inventory_item_id=inventory_item.id,
                            movement_type=InventoryMovementType.USE,
                            quantity=Decimal("2"),
                            created_at=in_period,
                            occurred_at=in_period,
                        ),
                        InventoryTransfer(
                            source_shop_id=current_shop.id,
                            transfer_shop_id=destination.id,
                            inventory_item_id=inventory_item.id,
                            quantity=Decimal("5"),
                            unit=BaseUnit.KG,
                            created_at=in_period,
                            occurred_at=in_period,
                        ),
                    ]
                )
                session.commit()

                overall = await build_overall_report(
                    db,
                    detail_level="summary",
                    period="date",
                    reference_date=report_date,
                    shop_ids=[current_shop.id],
                    organization_id=current_shop.organization_id,
                )

                statement = overall.statements[0]
                item = statement.inventory_items[0]
                self.assertEqual(item.old_stock, Decimal("13.000"))
                self.assertEqual(item.adding_stock, Decimal("10.000"))
                self.assertEqual(item.total_available_stock, Decimal("23.000"))
                self.assertEqual(item.used_stock, Decimal("2.000"))
                self.assertEqual(item.transfer_stock, Decimal("5.000"))
                self.assertEqual(item.remaining_stock, Decimal("16.000"))
                self.assertEqual(statement.unit_summaries[0].transfer_stock, Decimal("5.000"))

        self.run_async(scenario())

    def test_over_report_transfer_stock_uses_occurred_at_not_created_at(self) -> None:
        _actor, shop = self.run_async(
            self.harness.create_shop_user(shop_name="Backdate Transfer Branch")
        )

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.get(Shop, shop.id)
                inventory_item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Backdate Transfer Stock",
                        tamil_name="பின்தேதி பரிமாற்ற இருப்பு",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[],
                        billing_item_ids=[],
                    ),
                )
                await allocate_shop_inventory_items(db, current_shop, [inventory_item.id])
                destination = TransferShop(
                    name="Outside Backdate Branch",
                    tamil_name="வெளி பின்தேதி கிளை",
                    organization_id=current_shop.organization_id,
                )
                session.add(destination)
                session.flush()

                report_date = date(2026, 6, 1)
                in_period = datetime(2026, 6, 1, 10, tzinfo=UTC)
                recorded_later = datetime(2026, 7, 2, 15, tzinfo=UTC)
                session.add_all(
                    [
                        InventoryMovement(
                            shop_id=current_shop.id,
                            inventory_item_id=inventory_item.id,
                            movement_type=InventoryMovementType.ADD,
                            quantity=Decimal("20"),
                            created_at=in_period,
                            occurred_at=in_period,
                        ),
                        InventoryTransfer(
                            source_shop_id=current_shop.id,
                            transfer_shop_id=destination.id,
                            inventory_item_id=inventory_item.id,
                            quantity=Decimal("8"),
                            unit=BaseUnit.KG,
                            created_at=recorded_later,
                            occurred_at=in_period,
                        ),
                    ]
                )
                session.commit()

                overall = await build_overall_report(
                    db,
                    detail_level="summary",
                    period="date",
                    reference_date=report_date,
                    shop_ids=[current_shop.id],
                    organization_id=current_shop.organization_id,
                )

                item = overall.statements[0].inventory_items[0]
                self.assertEqual(item.transfer_stock, Decimal("8.000"))

        self.run_async(scenario())

    def test_register_admin_rejects_second_admin(self) -> None:
        self.run_async(self.harness.create_admin_user())

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                with self.assertRaises(HTTPException) as ctx:
                    await register_admin(
                        db,
                        RegisterRequest(
                            username="second-admin",
                            password="password123",
                            confirm_password="password123",
                        ),
                    )
                self.assertEqual(ctx.exception.status_code, 409)
                self.assertEqual(
                    ctx.exception.detail, "Admin registration is already completed"
                )

        self.run_async(scenario())

    def test_create_shop_account_returns_created_shop(self) -> None:
        actor = self.run_async(self.harness.create_admin_user())
        self.run_async(
            self.harness.create_shop_user(username="ml7", shop_name="Existing Shop")
        )

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                created = await create_shop_account(
                    AsyncSessionAdapter(session),
                    ShopCreate(
                        name="Fresh Shop", username="ml8", password="password123"
                    ),
                    actor,
                )
                self.assertEqual(created.username, "ml8")
                self.assertEqual(created.name, "Fresh Shop")

        self.run_async(scenario())

    def test_created_items_do_not_store_database_images(self) -> None:
        self.run_async(self.harness.create_catalogue_items(("Chicken",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                chicken = session.scalar(select(Item).where(Item.name == "Chicken"))
                self.assertIsNotNone(chicken)
                self.assertIsNone(chicken.image_object_key)
                self.assertIsNone(chicken.image_content_type)

        self.run_async(scenario())

    def test_item_assumption_validation_and_status(self) -> None:
        self.run_async(self.harness.create_catalogue_items(("Chicken", "Duck")))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                category = await create_inventory_category(
                    db,
                    InventoryCategoryCreate(name="Kitchen Use"),
                )
                other_category = await create_inventory_category(
                    db,
                    InventoryCategoryCreate(name="Other Use"),
                )
                inventory_item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Chicken Stock",
                        tamil_name="கோழி இருப்பு",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[category.id],
                    ),
                )
                chicken = session.scalar(select(Item).where(Item.name == "Chicken"))
                duck = session.scalar(select(Item).where(Item.name == "Duck"))

                saved = await update_item_assumption(
                    db,
                    chicken.id,
                    ItemAssumptionUpdate(
                        assumption_percent=Decimal("78"),
                        assumption_inventory_item_id=inventory_item.id,
                        assumption_inventory_category_id=category.id,
                    ),
                )
                self.assertEqual(saved.assumption_percent, Decimal("78"))
                self.assertEqual(saved.assumption_status, ItemAssumptionStatus.CONFIGURED)

                with self.assertRaises(ValidationError):
                    ItemAssumptionUpdate(
                        assumption_percent=Decimal("101"),
                        assumption_inventory_item_id=inventory_item.id,
                        assumption_inventory_category_id=category.id,
                    )
                percent_only = await update_item_assumption(
                    db,
                    chicken.id,
                    ItemAssumptionUpdate(assumption_percent=Decimal("65")),
                )
                self.assertEqual(percent_only.assumption_percent, Decimal("65"))
                self.assertIsNone(percent_only.assumption_inventory_item_id)
                self.assertIsNone(percent_only.assumption_inventory_category_id)
                self.assertEqual(percent_only.assumption_status, ItemAssumptionStatus.CONFIGURED)

                with self.assertRaises(HTTPException) as count_ctx:
                    await update_item_assumption(
                        db,
                        duck.id,
                        ItemAssumptionUpdate(
                            assumption_percent=Decimal("78"),
                            assumption_inventory_item_id=inventory_item.id,
                            assumption_inventory_category_id=category.id,
                        ),
                    )
                self.assertEqual(count_ctx.exception.status_code, 422)

                with self.assertRaises(HTTPException) as category_ctx:
                    await update_item_assumption(
                        db,
                        chicken.id,
                        ItemAssumptionUpdate(
                            assumption_percent=Decimal("78"),
                            assumption_inventory_item_id=inventory_item.id,
                            assumption_inventory_category_id=other_category.id,
                        ),
                    )
                self.assertEqual(category_ctx.exception.status_code, 422)

                cleared = await update_item_assumption(
                    db,
                    chicken.id,
                    ItemAssumptionUpdate(),
                )
                self.assertIsNone(cleared.assumption_percent)
                self.assertEqual(cleared.assumption_status, ItemAssumptionStatus.NOT_SET)

        self.run_async(scenario())

    def test_admin_report_pdf_can_include_over_report_statement(self) -> None:
        _actor, shop = self.run_async(
            self.harness.create_shop_user(shop_name="SK Nagar")
        )
        self.run_async(self.harness.create_catalogue_items(("Chicken", "Mutton", "Duck")))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.get(Shop, shop.id)
                chicken = session.scalar(
                    select(Item).where(Item.name == "Chicken", Item.shop_id.is_(None))
                )
                mutton = session.scalar(
                    select(Item).where(Item.name == "Mutton", Item.shop_id.is_(None))
                )
                duck = session.scalar(
                    select(Item).where(Item.name == "Duck", Item.shop_id.is_(None))
                )
                quail = Item(
                    organization_id=current_shop.organization_id,
                    name="Quail",
                    tamil_name="காடை",
                    unit_type=UnitType.COUNT,
                    base_unit=BaseUnit.UNIT,
                    sort_order=50,
                    category="Quail",
                    is_active=True,
                )
                session.add(quail)
                session.flush()
                await allocate_catalogue_item(db, current_shop, chicken.id)
                await allocate_catalogue_item(db, current_shop, mutton.id)
                await allocate_catalogue_item(db, current_shop, duck.id)
                await allocate_catalogue_item(db, current_shop, quail.id)
                category = await create_inventory_category(
                    db,
                    InventoryCategoryCreate(name="Chicken Without Skin"),
                )
                category_b = await create_inventory_category(
                    db,
                    InventoryCategoryCreate(name="Chicken With Skin"),
                )
                inventory_item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Chicken Stock",
                        tamil_name="கோழி இருப்பு",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[category.id, category_b.id],
                        billing_mappings=[
                            InventoryBillingItemMappingWrite(
                                inventory_category_id=category.id,
                                billing_item_id=chicken.id,
                            ),
                            InventoryBillingItemMappingWrite(
                                inventory_category_id=category_b.id,
                                billing_item_id=mutton.id,
                            ),
                        ],
                    ),
                )
                unit_inventory_item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Duck Stock",
                        tamil_name="வாத்து இருப்பு",
                        unit_type=UnitType.COUNT,
                        base_unit=BaseUnit.UNIT,
                        category_ids=[],
                        billing_item_ids=[duck.id],
                    ),
                )
                no_percent_unit_inventory_item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Quail Stock",
                        tamil_name="காடை இருப்பு",
                        unit_type=UnitType.COUNT,
                        base_unit=BaseUnit.UNIT,
                        category_ids=[],
                        billing_item_ids=[quail.id],
                    ),
                )
                unmapped_inventory_item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="No Mapping Stock",
                        tamil_name="இணைப்பு இல்லை",
                        unit_type=UnitType.COUNT,
                        base_unit=BaseUnit.UNIT,
                        category_ids=[],
                        billing_item_ids=[],
                    ),
                )
                await allocate_shop_inventory_items(
                    db,
                    current_shop,
                    [
                        inventory_item.id,
                        unit_inventory_item.id,
                        no_percent_unit_inventory_item.id,
                        unmapped_inventory_item.id,
                    ],
                )
                await add_shop_inventory_stock(
                    db,
                    current_shop,
                    inventory_item.id,
                    InventoryAddRequest(quantity=Decimal("20"), driver_name="Test Driver", vehicle_number="TN01AB1234"),
                )
                await add_shop_inventory_stock(
                    db,
                    current_shop,
                    unit_inventory_item.id,
                    InventoryAddRequest(quantity=Decimal("12"), driver_name="Test Driver", vehicle_number="TN01AB1234"),
                )
                await add_shop_inventory_stock(
                    db,
                    current_shop,
                    no_percent_unit_inventory_item.id,
                    InventoryAddRequest(quantity=Decimal("6"), driver_name="Test Driver", vehicle_number="TN01AB1234"),
                )
                await add_shop_inventory_stock(
                    db,
                    current_shop,
                    unmapped_inventory_item.id,
                    InventoryAddRequest(quantity=Decimal("5"), driver_name="Test Driver", vehicle_number="TN01AB1234"),
                )
                await update_item_assumption(
                    db,
                    chicken.id,
                    ItemAssumptionUpdate(assumption_percent=Decimal("78")),
                )
                await update_item_assumption(
                    db,
                    mutton.id,
                    ItemAssumptionUpdate(assumption_percent=Decimal("50")),
                )
                duck.assumption_percent = Decimal("25")
                session.flush()
                await use_shop_inventory_stock_split(
                    db,
                    current_shop,
                    inventory_item.id,
                    InventoryUseSplitRequest(
                        total_quantity=Decimal("15"),
                        categories=[
                            InventoryUseSplitLine(
                                category_id=category.id,
                                quantity=Decimal("10"),
                            ),
                            InventoryUseSplitLine(
                                category_id=category_b.id,
                                quantity=Decimal("5"),
                            ),
                        ],
                    ),
                )
                await use_shop_inventory_stock(
                    db,
                    current_shop,
                    unit_inventory_item.id,
                    InventoryUseRequest(quantity=Decimal("4")),
                )
                await use_shop_inventory_stock(
                    db,
                    current_shop,
                    no_percent_unit_inventory_item.id,
                    InventoryUseRequest(quantity=Decimal("2")),
                )
                await create_daily_prices(
                    db,
                    current_shop,
                    DailyPriceCreate(
                        entries=[
                            DailyPriceEntry(
                                item_id=chicken.id,
                                price_per_unit=Decimal("120.00"),
                            ),
                            DailyPriceEntry(
                                item_id=mutton.id,
                                price_per_unit=Decimal("100.00"),
                            ),
                            DailyPriceEntry(
                                item_id=duck.id,
                                price_per_unit=Decimal("25.00"),
                            ),
                            DailyPriceEntry(
                                item_id=quail.id,
                                price_per_unit=Decimal("30.00"),
                            ),
                        ]
                    ),
                    publish=True,
                )
                payload = BillCheckoutRequest(
                    items=[
                        BillItemInput(item_id=chicken.id, quantity=Decimal("10")),
                        BillItemInput(item_id=mutton.id, quantity=Decimal("5")),
                        BillItemInput(item_id=duck.id, quantity=Decimal("3")),
                        BillItemInput(item_id=quail.id, quantity=Decimal("2")),
                    ],
                    payment=CheckoutPaymentInput(
                        cash_amount=Decimal("1835.00"),
                        upi_amount=Decimal("0.00"),
                    ),
                )
                preview = await preview_bill(db, current_shop, payload)
                await create_bill(
                    db,
                    current_shop,
                    BillCheckoutCommitRequest(
                        items=payload.items,
                        payment=payload.payment,
                        checkout_token=preview.checkout_token,
                    ),
                )
                expense_item = ExpenseItem(
                    name="Coolie",
                    tamil_name="கூலி",
                    organization_id=current_shop.organization_id,
                )
                session.add(expense_item)
                session.flush()
                session.add(
                    ExpenseEntry(
                        shop_id=current_shop.id,
                        expense_item_id=expense_item.id,
                        expense_name=expense_item.name,
                        expense_tamil_name=expense_item.tamil_name,
                        amount=Decimal("100.00"),
                        spent_at=datetime.now(UTC),
                    )
                )
                session.commit()

                overall = await build_overall_report(
                    db,
                    detail_level="summary",
                    period="date",
                    shop_ids=[current_shop.id],
                    organization_id=current_shop.organization_id,
                )
                self.assertEqual(len(overall.statements), 1)
                statement = overall.statements[0]
                self.assertEqual(statement.sales_amount, Decimal("1835.00"))
                self.assertEqual(statement.expense_amount, Decimal("100.00"))
                self.assertEqual(statement.assumption_amount, Decimal("1211.000"))
                self.assertEqual(statement.difference_amount, Decimal("624.000"))
                summaries_by_unit = {summary.unit: summary for summary in statement.unit_summaries}
                self.assertEqual(summaries_by_unit[BaseUnit.KG].adding_stock, Decimal("20.000"))
                self.assertEqual(summaries_by_unit[BaseUnit.KG].used_stock, Decimal("15.000"))
                self.assertEqual(summaries_by_unit[BaseUnit.KG].sales_quantity, Decimal("15.000"))
                self.assertEqual(summaries_by_unit[BaseUnit.KG].assumption_quantity, Decimal("10.300"))
                self.assertEqual(summaries_by_unit[BaseUnit.UNIT].adding_stock, Decimal("23.000"))
                self.assertEqual(summaries_by_unit[BaseUnit.UNIT].used_stock, Decimal("6.000"))
                self.assertEqual(summaries_by_unit[BaseUnit.UNIT].sales_quantity, Decimal("5.000"))
                self.assertEqual(summaries_by_unit[BaseUnit.UNIT].assumption_quantity, Decimal("1.000"))

                items_by_name = {item.item_name: item for item in statement.inventory_items}
                chicken_stock = items_by_name["Chicken Stock"]
                breakdown_by_label = {
                    row.label: row.quantity for row in chicken_stock.used_stock_breakdown
                }
                self.assertEqual(breakdown_by_label["Chicken Without Skin"], Decimal("10.000"))
                self.assertEqual(breakdown_by_label["Chicken With Skin"], Decimal("5.000"))
                self.assertEqual(chicken_stock.assumption_quantity, Decimal("10.300"))
                self.assertEqual(chicken_stock.difference_amount, Decimal("514.000"))
                duck_stock = items_by_name["Duck Stock"]
                self.assertEqual(duck_stock.unit, BaseUnit.UNIT)
                self.assertEqual(duck_stock.sales_quantity, Decimal("3.000"))
                self.assertEqual(duck_stock.assumption_quantity, Decimal("1.000"))
                self.assertEqual(duck_stock.difference_amount, Decimal("50.000"))
                self.assertEqual(duck_stock.used_stock_breakdown[0].label, "Used")
                self.assertEqual(duck_stock.used_stock_breakdown[0].quantity, Decimal("4.000"))
                self.assertEqual(len(duck_stock.billing_items), 1)
                self.assertEqual(duck_stock.billing_items[0].assumption_percent, Decimal("25"))
                quail_stock = items_by_name["Quail Stock"]
                self.assertEqual(quail_stock.assumption_quantity, Decimal("0"))
                self.assertEqual(quail_stock.difference_amount, Decimal("60.000"))
                self.assertIsNone(quail_stock.billing_items[0].assumption_percent)
                self.assertEqual(items_by_name["No Mapping Stock"].billing_items, [])

                def get_pdf_text(pdf_bytes: bytes) -> str:
                    from pypdf import PdfReader
                    reader = PdfReader(BytesIO(pdf_bytes))
                    raw_text = "\n".join([page.extract_text() for page in reader.pages])
                    return " ".join(raw_text.split())

                report = await generate_admin_report_pdf(
                    db,
                    sections=["over_report"],
                    period="date",
                    organization_id=current_shop.organization_id,
                )
                try:
                    data = report.file.read()
                    self.assertGreater(len(data), 0)
                    text_content = get_pdf_text(data)
                    self.assertIn("BROLIER 360 DEFAULT", text_content)
                    self.assertIn("SK NAGAR", text_content)
                    self.assertIn("Inventory Item", text_content)
                    self.assertIn("Used Stock", text_content)
                    self.assertIn("Kg/Unit", text_content)
                    self.assertIn("Assumption Amount", text_content)
                    self.assertIn("Total Available Stock", text_content)
                    self.assertIn("Chicken", text_content)
                    self.assertIn("Mutton", text_content)
                    self.assertIn("Duck Stock", text_content)
                    self.assertIn("Quail Stock", text_content)
                    self.assertIn("No Mapping Stock", text_content)
                    self.assertIn("Chicken With", text_content)
                    self.assertIn("Chicken Without", text_content)
                    self.assertIn("3 Unit", text_content)
                    self.assertIn("No mapped billing Items", text_content)
                    self.assertIn("₹936.00", text_content)
                    self.assertIn("₹250.00", text_content)
                    self.assertIn("₹25.00", text_content)
                    self.assertIn("₹60.00", text_content)
                    self.assertIn("₹264.00", text_content)
                finally:
                    report.file.close()

                today = datetime.now(UTC).date()
                tomorrow = today + timedelta(days=1)
                full_range_report = await generate_admin_report_pdf(
                    db,
                    sections=["over_report"],
                    detail_level="full",
                    period="range",
                    range_start_date=today,
                    range_end_date=tomorrow,
                    organization_id=current_shop.organization_id,
                )
                try:
                    data = full_range_report.file.read()
                    text_content = get_pdf_text(data)
                    today_text = today.strftime("%d/%m/%Y")
                    tomorrow_text = tomorrow.strftime("%d/%m/%Y")
                    self.assertIn(f"Date: {today_text} To {tomorrow_text}", text_content)
                    self.assertIn(today_text, text_content)
                    self.assertIn(tomorrow_text, text_content)
                finally:
                    full_range_report.file.close()

        self.run_async(scenario())

    def test_item_image_upload_requires_rustfs(self) -> None:
        self.run_async(self.harness.create_catalogue_items(("Chicken",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                chicken = session.scalar(select(Item).where(Item.name == "Chicken"))
                self.assertIsNotNone(chicken)
                with self.assertRaises(HTTPException) as ctx:
                    await item_storage.save_item_image_content(
                        AsyncSessionAdapter(session),
                        chicken,
                        filename="chicken.jpg",
                        content=b"image-bytes",
                        content_type="image/jpeg",
                    )
                self.assertEqual(ctx.exception.status_code, 503)
                self.assertIsNone(chicken.image_object_key)
                self.assertIsNone(chicken.image_content_type)

        self.run_async(scenario())

    def test_rustfs_endpoint_host_header_from_url(self) -> None:
        original = item_storage.settings.rustfs_endpoint_url
        try:
            item_storage.settings.rustfs_endpoint_url = "http://rustfs:9000"
            self.assertEqual(item_storage._rustfs_endpoint_host_header(), "rustfs:9000")
        finally:
            item_storage.settings.rustfs_endpoint_url = original

    def test_rustfs_s3_host_header_derives_api_port_from_console_domain(self) -> None:
        original_domains = item_storage.settings.rustfs_server_domains_raw
        original_override = item_storage.settings.rustfs_s3_host_header
        try:
            item_storage.settings.rustfs_server_domains_raw = "16.112.68.20:9001"
            item_storage.settings.rustfs_s3_host_header = None
            self.assertEqual(
                item_storage._resolve_rustfs_s3_host_header(),
                "16.112.68.20:9000",
            )
        finally:
            item_storage.settings.rustfs_server_domains_raw = original_domains
            item_storage.settings.rustfs_s3_host_header = original_override
            item_storage._get_storage_client.cache_clear()

    def test_rustfs_head_bucket_400_on_valid_bucket_reports_host_mismatch(self) -> None:
        original_bucket = item_storage.settings.rustfs_bucket_name
        original_endpoint = item_storage.settings.rustfs_endpoint_url
        original_domains = item_storage.settings.rustfs_server_domains_raw
        item_storage.settings.rustfs_bucket_name = "pos-mlb-items"
        item_storage.settings.rustfs_endpoint_url = "http://rustfs:9000"
        item_storage.settings.rustfs_server_domains_raw = "16.112.68.20:9001"
        try:
            exc = ClientError(
                {
                    "Error": {"Code": "InvalidBucketName"},
                    "ResponseMetadata": {"HTTPStatusCode": 400},
                },
                "HeadBucket",
            )
            with self.assertRaises(RuntimeError) as ctx:
                item_storage._raise_rustfs_head_bucket_error(exc)
            message = str(ctx.exception)
            self.assertIn("Host header", message)
            self.assertIn("16.112.68.20:9000", message)
        finally:
            item_storage.settings.rustfs_bucket_name = original_bucket
            item_storage.settings.rustfs_endpoint_url = original_endpoint
            item_storage.settings.rustfs_server_domains_raw = original_domains

    def test_item_image_variants_use_thumbnails_and_uuid7_keys(self) -> None:
        original, original_content_type, thumbnail, thumbnail_content_type = (
            item_storage._prepare_square_image_variants(_square_image_bytes(1200))
        )

        self.assertEqual(original_content_type, "image/jpeg")
        self.assertEqual(thumbnail_content_type, "image/jpeg")
        with Image.open(BytesIO(original)) as original_image:
            self.assertEqual(original_image.size, (1024, 1024))
        with Image.open(BytesIO(thumbnail)) as thumbnail_image:
            self.assertEqual(thumbnail_image.size, (192, 192))

        item_id = UUID("018f36ba-7c1f-7c2d-9d67-000000000001")
        object_key = item_storage._get_object_key(
            item_id,
            "chicken.jpg",
            variant="thumb",
        )
        object_uuid = UUID(hex=Path(object_key).stem)
        self.assertEqual(object_uuid.version, 7)
        self.assertIn(f"items/{item_id}/thumb/", object_key)

    def test_item_image_path_uses_public_rustfs_url_when_enabled(self) -> None:
        original_values = (
            item_storage.settings.rustfs_public_read_enabled,
            item_storage.settings.rustfs_public_base_url,
            item_storage.settings.rustfs_bucket_name,
        )
        item_storage.settings.rustfs_public_read_enabled = True
        item_storage.settings.rustfs_public_base_url = "https://pos.example/rustfs/"
        item_storage.settings.rustfs_bucket_name = "pos-mlb-items"
        try:
            item_id = UUID("018f36ba-7c1f-7c2d-9d67-000000000001")
            image_path = item_storage.build_item_image_path(
                item_id,
                "items/chicken/thumb/image.jpg",
                variant="thumb",
            )
            self.assertEqual(
                image_path,
                "https://pos.example/rustfs/pos-mlb-items/items/chicken/thumb/image.jpg",
            )
        finally:
            (
                item_storage.settings.rustfs_public_read_enabled,
                item_storage.settings.rustfs_public_base_url,
                item_storage.settings.rustfs_bucket_name,
            ) = original_values

    def test_item_image_path_appends_cache_buster_for_proxy_urls(self) -> None:
        item_id = UUID("018f36ba-7c1f-7c2d-9d67-000000000001")
        object_key = "orgs/org-id/items/item-id/original/018fdeadbeef.jpg"
        image_path = item_storage.build_item_image_path(item_id, object_key)
        thumb_path = item_storage.build_item_image_thumb_path(
            item_id,
            f"{object_key.rsplit('/', 1)[0]}/thumb/018fdeadbeef-thumb.jpg",
            original_object_key=object_key,
        )
        self.assertEqual(
            image_path,
            f"/api/v1/catalog/items/{item_id}/image?v=018fdeadbeef.jpg",
        )
        self.assertEqual(
            thumb_path,
            f"/api/v1/catalog/items/{item_id}/image?variant=thumb&v=018fdeadbeef-thumb.jpg",
        )

    def test_stored_image_stream_iterator_closes_body(self) -> None:
        class Body:
            def __init__(self) -> None:
                self.closed = False
                self.remaining = [b"ab", b"cd", b""]

            def read(self, chunk_size: int) -> bytes:
                assert chunk_size > 0
                return self.remaining.pop(0)

            def close(self) -> None:
                self.closed = True

        body = Body()
        payload = item_storage.StoredImageStreamPayload(
            body=body,
            content_type="image/jpeg",
            object_key="items/chicken/original/image.jpg",
            etag='"stream-etag"',
            last_modified=datetime(2026, 5, 31, tzinfo=UTC),
            cache_control=item_storage.PROXY_IMAGE_CACHE_CONTROL,
        )

        self.assertEqual(list(item_storage.iter_stored_image_stream(payload)), [b"ab", b"cd"])
        self.assertTrue(body.closed)

    def test_inventory_management_ledger_rules(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.scalar(select(Shop).where(Shop.id == shop.id))
                category_a = await create_inventory_category(
                    db, InventoryCategoryCreate(name="A1")
                )
                category_b = await create_inventory_category(
                    db, InventoryCategoryCreate(name="A2")
                )
                with self.assertRaises(HTTPException) as duplicate_ctx:
                    await create_inventory_category(db, InventoryCategoryCreate(name="a1"))
                self.assertEqual(duplicate_ctx.exception.status_code, 409)

                item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Inventory A",
                        tamil_name="சரக்கு ஏ",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[category_a.id, category_b.id],
                    ),
                )
                listed_page = await list_inventory_item_rows(db, q="inventory", limit=100)
                listed_item = next(row for row in listed_page.items if row.id == item.id)
                self.assertEqual(listed_item.category_ids, [category_a.id, category_b.id])
                self.assertEqual(
                    [category.name for category in listed_item.categories],
                    ["A1", "A2"],
                )

                with self.assertRaises(HTTPException) as linked_category_delete_ctx:
                    await delete_inventory_category(db, category_b.id)
                self.assertEqual(linked_category_delete_ctx.exception.status_code, 409)

                unallocated_item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Unallocated",
                        tamil_name="ஒதுக்காதது",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[category_a.id],
                    ),
                )

                with self.assertRaises(HTTPException) as unallocated_ctx:
                    await add_shop_inventory_stock(
                        db,
                        current_shop,
                        unallocated_item.id,
                        InventoryAddRequest(
                            quantity=Decimal("1"),
                            driver_name="Test Driver",
                            vehicle_number="TN01AB1234",
                        ),
                    )
                self.assertEqual(unallocated_ctx.exception.status_code, 404)

                allocation = await allocate_shop_inventory_items(db, current_shop, [item.id])
                self.assertEqual(allocation.allocated_count, 1)
                self.assertEqual(allocation.already_allocated_count, 0)

                add_result = await add_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryAddRequest(quantity=Decimal("10"), driver_name="Test Driver", vehicle_number="TN01AB1234"),
                )
                self.assertIsNone(add_result.summary)
                self.assertEqual(add_result.item.available_quantity, Decimal("10.000"))

                use_result = await use_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryUseRequest(category_id=category_a.id, quantity=Decimal("3")),
                )
                self.assertIsNone(use_result.summary)
                self.assertEqual(use_result.item.available_quantity, Decimal("7.000"))

                add_movement = session.scalar(
                    select(InventoryMovement).where(InventoryMovement.id == add_result.movement.id)
                )
                use_movement = session.scalar(
                    select(InventoryMovement).where(InventoryMovement.id == use_result.movement.id)
                )
                add_movement.occurred_at = datetime(2026, 6, 1, 10, tzinfo=UTC)
                use_movement.occurred_at = datetime(2026, 6, 3, 11, tzinfo=UTC)
                session.commit()

                date_movements = await list_inventory_movements(
                    db,
                    shop_id=current_shop.id,
                    reference_date=date(2026, 6, 3),
                    limit=10,
                )
                self.assertEqual([movement.id for movement in date_movements.items], [use_result.movement.id])

                empty_date_movements = await list_inventory_movements(
                    db,
                    shop_id=current_shop.id,
                    reference_date=date(2026, 6, 2),
                    limit=10,
                )
                self.assertEqual(empty_date_movements.items, [])

                range_movements = await list_inventory_movements(
                    db,
                    shop_id=current_shop.id,
                    range_start_date=date(2026, 6, 1),
                    range_end_date=date(2026, 6, 3),
                    limit=10,
                )
                self.assertEqual(
                    {movement.id for movement in range_movements.items},
                    {add_result.movement.id, use_result.movement.id},
                )

                with patch("app.services.inventory.date") as inventory_date:
                    inventory_date.today.return_value = date(2026, 6, 3)
                    summary = await get_inventory_summary(db, current_shop)
                stock_item = next(row for row in summary.items if row.id == item.id)
                self.assertEqual(stock_item.available_quantity, Decimal("7.000"))
                self.assertEqual(stock_item.added_quantity, Decimal("10.000"))
                self.assertEqual(stock_item.used_quantity, Decimal("3.000"))
                usage_by_category = {
                    usage.category_id: usage for usage in stock_item.category_usage
                }
                self.assertEqual(
                    usage_by_category[category_a.id].used_quantity,
                    Decimal("3.000"),
                )
                self.assertEqual(
                    usage_by_category[category_b.id].used_quantity,
                    Decimal("0"),
                )
                self.assertEqual(
                    usage_by_category[category_a.id].available_quantity,
                    Decimal("7.000"),
                )
                self.assertEqual(
                    usage_by_category[category_b.id].available_quantity,
                    Decimal("7.000"),
                )

                with self.assertRaises(HTTPException) as unlink_used_category_ctx:
                    await update_inventory_management_item(
                        db,
                        item.id,
                        InventoryItemUpdate(
                            name=item.name,
                            tamil_name=item.tamil_name,
                            unit_type=item.unit_type,
                            base_unit=item.base_unit,
                            category_ids=[category_b.id],
                        ),
                    )
                self.assertEqual(unlink_used_category_ctx.exception.status_code, 409)

                item = await update_inventory_management_item(
                    db,
                    item.id,
                    InventoryItemUpdate(
                        name=item.name,
                        tamil_name=item.tamil_name,
                        unit_type=item.unit_type,
                        base_unit=item.base_unit,
                        category_ids=[category_a.id],
                    ),
                )
                self.assertEqual(item.category_ids, [category_a.id])
                await delete_inventory_category(db, category_b.id)

                category_c = await create_inventory_category(
                    db, InventoryCategoryCreate(name="A3")
                )
                with self.assertRaises(HTTPException) as wrong_category_ctx:
                    await use_shop_inventory_stock(
                        db,
                        current_shop,
                        item.id,
                        InventoryUseRequest(category_id=category_c.id, quantity=Decimal("1")),
                    )
                self.assertEqual(wrong_category_ctx.exception.status_code, 422)

                with self.assertRaises(HTTPException) as missing_category_ctx:
                    await use_shop_inventory_stock(
                        db,
                        current_shop,
                        item.id,
                        InventoryUseRequest(quantity=Decimal("1")),
                    )
                self.assertEqual(missing_category_ctx.exception.status_code, 422)

                with self.assertRaises(HTTPException) as overuse_ctx:
                    await use_shop_inventory_stock(
                        db,
                        current_shop,
                        item.id,
                        InventoryUseRequest(category_id=category_a.id, quantity=Decimal("8")),
                    )
                self.assertEqual(overuse_ctx.exception.status_code, 409)

                await delete_inventory_management_item(db, item.id)

                with self.assertRaises(HTTPException) as deleted_item_ctx:
                    await get_inventory_item(db, item.id)
                self.assertEqual(deleted_item_ctx.exception.status_code, 404)

                movements_after_delete = await list_inventory_movements(
                    db,
                    item_id=item.id,
                    limit=10,
                )
                self.assertEqual(movements_after_delete.items, [])
                summary_after_delete = await get_inventory_summary(db, current_shop)
                self.assertFalse(
                    any(stock_item.id == item.id for stock_item in summary_after_delete.items)
                )

        self.run_async(scenario())

    def test_uncategorized_inventory_item_can_use_stock(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.scalar(select(Shop).where(Shop.id == shop.id))
                item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Loose Stock",
                        tamil_name="தளர்ந்த சரக்கு",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[],
                    ),
                )
                await allocate_shop_inventory_items(db, current_shop, [item.id])
                await add_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryAddRequest(quantity=Decimal("10"), driver_name="Test Driver", vehicle_number="TN01AB1234"),
                )

                use_result = await use_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryUseRequest(quantity=Decimal("3")),
                )

                self.assertIsNone(use_result.movement.category_id)
                self.assertIsNone(use_result.movement.category_name)
                self.assertEqual(use_result.item.available_quantity, Decimal("7.000"))
                self.assertEqual(use_result.item.used_quantity, Decimal("3.000"))
                self.assertEqual(use_result.item.category_usage, [])

                summary = await get_inventory_summary(db, current_shop)
                stock_item = next(row for row in summary.items if row.id == item.id)
                self.assertEqual(stock_item.available_quantity, Decimal("7.000"))
                self.assertEqual(stock_item.used_quantity, Decimal("3.000"))
                self.assertEqual(stock_item.category_usage, [])

                with self.assertRaises(HTTPException) as overuse_ctx:
                    await use_shop_inventory_stock(
                        db,
                        current_shop,
                        item.id,
                        InventoryUseRequest(quantity=Decimal("8")),
                    )
                self.assertEqual(overuse_ctx.exception.status_code, 409)

        self.run_async(scenario())

    def test_inventory_items_map_categories_or_items_to_one_billing_item(
        self,
    ) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_catalogue_items(("Chicken", "Mutton")))
        self.run_async(self.harness.create_items_for_shop(shop.id, ("Chicken",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                chicken = session.scalar(
                    select(Item).where(Item.name == "Chicken", Item.shop_id.is_(None))
                )
                mutton = session.scalar(
                    select(Item).where(Item.name == "Mutton", Item.shop_id.is_(None))
                )
                shop_chicken = session.scalar(
                    select(Item).where(Item.name == "Chicken", Item.shop_id == shop.id)
                )
                egg_count = Item(
                    organization_id=shop.organization_id,
                    name="Egg Count",
                    tamil_name="முட்டை",
                    unit_type=UnitType.COUNT,
                    base_unit=BaseUnit.UNIT,
                    sort_order=20,
                    category="Eggs",
                    is_active=True,
                )
                session.add(egg_count)
                session.commit()
                session.refresh(egg_count)

                category_a = await create_inventory_category(
                    db, InventoryCategoryCreate(name="Mapped Stock A")
                )
                category_b = await create_inventory_category(
                    db, InventoryCategoryCreate(name="Mapped Stock B")
                )
                with self.assertRaises(HTTPException) as duplicate_ctx:
                    await create_inventory_management_item(
                        db,
                        InventoryItemCreate(
                            name="Duplicate Billing Category Stock",
                            tamil_name="இரட்டை இணைப்பு இருப்பு",
                            unit_type=UnitType.WEIGHT,
                            base_unit=BaseUnit.KG,
                            category_ids=[category_a.id, category_b.id],
                            billing_mappings=[
                                InventoryBillingItemMappingWrite(
                                    inventory_category_id=category_a.id,
                                    billing_item_id=chicken.id,
                                ),
                                InventoryBillingItemMappingWrite(
                                    inventory_category_id=category_b.id,
                                    billing_item_id=chicken.id,
                                ),
                            ],
                        ),
                    )
                self.assertEqual(duplicate_ctx.exception.status_code, 422)

                item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Mapped Chicken Stock",
                        tamil_name="மேப் கோழி இருப்பு",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[category_a.id, category_b.id],
                        billing_mappings=[
                            InventoryBillingItemMappingWrite(
                                inventory_category_id=category_a.id,
                                billing_item_id=chicken.id,
                            ),
                            InventoryBillingItemMappingWrite(
                                inventory_category_id=category_b.id,
                                billing_item_id=mutton.id,
                            ),
                        ],
                    ),
                )

                self.assertEqual(set(item.billing_item_ids), {chicken.id, mutton.id})
                self.assertIsNone(item.billing_item_id)
                self.assertEqual(
                    item.category_billing_item_ids,
                    {category_a.id: chicken.id, category_b.id: mutton.id},
                )
                self.assertEqual(
                    {
                        (
                            billing_item.inventory_category_id,
                            billing_item.inventory_category_name,
                            billing_item.billing_item_name,
                            billing_item.billing_item_tamil_name,
                        )
                        for billing_item in item.billing_items
                    },
                    {
                        (category_a.id, category_a.name, "Chicken", chicken.tamil_name),
                        (category_b.id, category_b.name, "Mutton", mutton.tamil_name),
                    },
                )
                self.assertEqual(set(item.category_ids), {category_a.id, category_b.id})

                detail = await get_inventory_item(db, item.id)
                self.assertEqual(set(detail.billing_item_ids), {chicken.id, mutton.id})
                self.assertEqual(
                    detail.category_billing_item_ids,
                    {category_a.id: chicken.id, category_b.id: mutton.id},
                )

                rows_page = await list_inventory_item_rows(db, q="Mapped Chicken", limit=10)
                paged_item = next(row for row in rows_page.items if row.id == item.id)
                self.assertEqual(set(paged_item.billing_item_ids), {chicken.id, mutton.id})
                self.assertEqual(
                    paged_item.category_billing_item_ids,
                    {category_a.id: chicken.id, category_b.id: mutton.id},
                )

                cleared = await update_inventory_management_item(
                    db,
                    item.id,
                    InventoryItemUpdate(
                        name=item.name,
                        tamil_name=item.tamil_name,
                        unit_type=item.unit_type,
                        base_unit=item.base_unit,
                        category_ids=item.category_ids,
                        billing_mappings=[],
                    ),
                )
                self.assertEqual(cleared.billing_item_ids, [])
                self.assertEqual(cleared.category_billing_item_ids, {})
                self.assertEqual(
                    set(cleared.category_ids),
                    {category_a.id, category_b.id},
                )

                remapped = await update_inventory_management_item(
                    db,
                    item.id,
                    InventoryItemUpdate(
                        name=item.name,
                        tamil_name=item.tamil_name,
                        unit_type=item.unit_type,
                        base_unit=item.base_unit,
                        category_ids=item.category_ids,
                        billing_mappings=[
                            InventoryBillingItemMappingWrite(
                                inventory_category_id=category_b.id,
                                billing_item_id=mutton.id,
                            )
                        ],
                    ),
                )
                self.assertEqual(remapped.billing_item_ids, [mutton.id])
                self.assertEqual(remapped.category_billing_item_ids, {category_b.id: mutton.id})
                self.assertEqual(
                    {
                        billing_item.billing_item_name
                        for billing_item in remapped.billing_items
                    },
                    {"Mutton"},
                )

                item_level_mapping = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Egg Tray Stock",
                        tamil_name="முட்டை தட்டு இருப்பு",
                        unit_type=UnitType.COUNT,
                        base_unit=BaseUnit.UNIT,
                        billing_item_id=egg_count.id,
                        category_ids=[],
                    ),
                )
                self.assertEqual(item_level_mapping.billing_item_id, egg_count.id)
                self.assertEqual(item_level_mapping.billing_item_ids, [egg_count.id])
                self.assertEqual(item_level_mapping.category_billing_item_ids, {})
                self.assertIsNone(item_level_mapping.billing_items[0].inventory_category_id)

                with self.assertRaises(HTTPException) as reused_billing_ctx:
                    await create_inventory_management_item(
                        db,
                        InventoryItemCreate(
                            name="Reused Billing Item Stock",
                            tamil_name="மீண்டும் இணைப்பு இருப்பு",
                            unit_type=UnitType.WEIGHT,
                            base_unit=BaseUnit.KG,
                            billing_item_id=mutton.id,
                            category_ids=[],
                        ),
                    )
                self.assertEqual(reused_billing_ctx.exception.status_code, 409)

                with self.assertRaises(HTTPException) as multi_item_level_ctx:
                    await create_inventory_management_item(
                        db,
                        InventoryItemCreate(
                            name="Multi Billing Item Stock",
                            tamil_name="பல இணைப்பு இருப்பு",
                            unit_type=UnitType.WEIGHT,
                            base_unit=BaseUnit.KG,
                            billing_item_ids=[chicken.id, mutton.id],
                            category_ids=[],
                        ),
                    )
                self.assertEqual(multi_item_level_ctx.exception.status_code, 422)

                with self.assertRaises(HTTPException) as shop_item_level_ctx:
                    await create_inventory_management_item(
                        db,
                        InventoryItemCreate(
                            name="Shop Item Level Mapping Stock",
                            tamil_name="கடை பொருள் நேரடி இருப்பு",
                            unit_type=UnitType.WEIGHT,
                            base_unit=BaseUnit.KG,
                            billing_item_ids=[shop_chicken.id],
                            category_ids=[category_a.id],
                        ),
                    )
                self.assertEqual(shop_item_level_ctx.exception.status_code, 422)

                with self.assertRaises(HTTPException) as unit_item_level_ctx:
                    await create_inventory_management_item(
                        db,
                        InventoryItemCreate(
                            name="Wrong Unit Item Level Mapping Stock",
                            tamil_name="தவறான அலகு நேரடி இருப்பு",
                            unit_type=UnitType.WEIGHT,
                            base_unit=BaseUnit.KG,
                            billing_item_ids=[egg_count.id],
                            category_ids=[category_a.id],
                        ),
                    )
                self.assertEqual(unit_item_level_ctx.exception.status_code, 422)

        self.run_async(scenario())

    def test_inventory_unit_items_require_whole_quantities(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.scalar(select(Shop).where(Shop.id == shop.id))
                category = await create_inventory_category(
                    db, InventoryCategoryCreate(name="Crates")
                )
                item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Egg Tray",
                        tamil_name="முட்டை தட்டு",
                        unit_type=UnitType.COUNT,
                        base_unit=BaseUnit.UNIT,
                        category_ids=[category.id],
                    ),
                )
                await allocate_shop_inventory_items(db, current_shop, [item.id])
                with self.assertRaises(HTTPException) as quantity_ctx:
                    await add_shop_inventory_stock(
                        db,
                        current_shop,
                        item.id,
                        InventoryAddRequest(
                            quantity=Decimal("1.5"),
                            driver_name="Test Driver",
                            vehicle_number="TN01AB1234",
                        ),
                    )
                self.assertEqual(quantity_ctx.exception.status_code, 422)

                await add_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryAddRequest(
                        quantity=Decimal("2"),
                        driver_name="Test Driver",
                        vehicle_number="TN01AB1234",
                    ),
                )
                await use_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryUseRequest(category_id=category.id, quantity=Decimal("1")),
                )
                summary = await get_inventory_summary(db, current_shop)
                stock_item = next(row for row in summary.items if row.id == item.id)
                self.assertEqual(stock_item.available_quantity, Decimal("1.000"))

        self.run_async(scenario())

    def test_inventory_use_split_requires_matching_category_total(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.scalar(select(Shop).where(Shop.id == shop.id))
                category_a = await create_inventory_category(
                    db, InventoryCategoryCreate(name="Kitchen")
                )
                category_b = await create_inventory_category(
                    db, InventoryCategoryCreate(name="Counter")
                )
                item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Split Stock",
                        tamil_name="பிரிப்பு சரக்கு",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[category_a.id, category_b.id],
                    ),
                )
                await allocate_shop_inventory_items(db, current_shop, [item.id])
                await add_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryAddRequest(quantity=Decimal("10"), driver_name="Test Driver", vehicle_number="TN01AB1234"),
                )

                with self.assertRaises(HTTPException) as mismatch_ctx:
                    await use_shop_inventory_stock_split(
                        db,
                        current_shop,
                        item.id,
                        InventoryUseSplitRequest(
                            total_quantity=Decimal("5"),
                            categories=[
                                InventoryUseSplitLine(
                                    category_id=category_a.id,
                                    quantity=Decimal("2"),
                                ),
                                InventoryUseSplitLine(
                                    category_id=category_b.id,
                                    quantity=Decimal("2"),
                                ),
                            ],
                        ),
                    )
                self.assertEqual(mismatch_ctx.exception.status_code, 422)

                result = await use_shop_inventory_stock_split(
                    db,
                    current_shop,
                    item.id,
                    InventoryUseSplitRequest(
                        total_quantity=Decimal("5"),
                        categories=[
                            InventoryUseSplitLine(
                                category_id=category_a.id,
                                quantity=Decimal("2"),
                            ),
                            InventoryUseSplitLine(
                                category_id=category_b.id,
                                quantity=Decimal("3"),
                            ),
                        ],
                    ),
                )

                self.assertEqual(len(result.movements), 2)
                self.assertIsNone(result.summary)
                stock_item = result.item
                self.assertEqual(stock_item.available_quantity, Decimal("5.000"))
                self.assertEqual(stock_item.used_quantity, Decimal("5.000"))
                usage_by_category = {
                    usage.category_id: usage for usage in stock_item.category_usage
                }
                self.assertEqual(
                    usage_by_category[category_a.id].used_quantity,
                    Decimal("2.000"),
                )
                self.assertEqual(
                    usage_by_category[category_b.id].used_quantity,
                    Decimal("3.000"),
                )

        self.run_async(scenario())

    def test_inventory_mutation_can_include_full_summary(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.scalar(select(Shop).where(Shop.id == shop.id))
                category = await create_inventory_category(
                    db, InventoryCategoryCreate(name="Summary Mode")
                )
                item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Summary Stock",
                        tamil_name="சுருக்க சரக்கு",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[category.id],
                    ),
                )
                await allocate_shop_inventory_items(db, current_shop, [item.id])

                result = await add_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryAddRequest(
                        quantity=Decimal("2"),
                        driver_name="Test Driver",
                        vehicle_number="TN01AB1234",
                    ),
                    include_summary=True,
                )

                self.assertIsNotNone(result.summary)
                self.assertEqual(result.item.available_quantity, Decimal("2.000"))
                summary_item = next(row for row in result.summary.items if row.id == item.id)
                self.assertEqual(summary_item.available_quantity, Decimal("2.000"))

        self.run_async(scenario())

    def test_inventory_add_stock_persists_full_vehicle_number(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        long_vehicle = "Ashok Leyland Dost TN-38-AZ-1234 Extra Long Vehicle Description"

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.scalar(select(Shop).where(Shop.id == shop.id))
                category = await create_inventory_category(
                    db, InventoryCategoryCreate(name="Vehicle History")
                )
                item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Vehicle Stock",
                        tamil_name="வாகன சரக்கு",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[category.id],
                    ),
                )
                await allocate_shop_inventory_items(db, current_shop, [item.id])

                result = await add_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryAddRequest(
                        quantity=Decimal("3"),
                        driver_name="Test Driver",
                        vehicle_number=long_vehicle,
                    ),
                )
                page = await list_inventory_movements(db, shop_id=current_shop.id, item_id=item.id, limit=10)

                self.assertEqual(result.movement.vehicle_number, long_vehicle)
                self.assertEqual(page.items[0].vehicle_number, long_vehicle)

        self.run_async(scenario())

    def test_inventory_add_request_rejects_single_character_vehicle_number(self) -> None:
        with self.assertRaises(ValidationError):
            InventoryAddRequest(
                quantity=Decimal("3"),
                driver_name="Test Driver",
                vehicle_number=" T ",
            )

    def test_inventory_add_request_normalizes_vehicle_number_whitespace(self) -> None:
        payload = InventoryAddRequest(
            quantity=Decimal("3"),
            driver_name="  Test   Driver  ",
            vehicle_number=" TN 38   AZ 1234 ",
        )

        self.assertEqual(payload.driver_name, "Test Driver")
        self.assertEqual(payload.vehicle_number, "TN 38 AZ 1234")

    def test_inventory_item_rows_page_and_counts(self) -> None:
        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                category = await create_inventory_category(
                    db, InventoryCategoryCreate(name="Paged Category")
                )
                alpha = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Paged Alpha",
                        tamil_name="பக்கம் அ",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        sort_order=10,
                        category_ids=[category.id],
                    ),
                )
                beta = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Paged Beta",
                        tamil_name="பக்கம் ஆ",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        sort_order=20,
                        category_ids=[category.id],
                    ),
                )
                await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Paged Paused",
                        tamil_name="பக்கம் நிறுத்தம்",
                        unit_type=UnitType.COUNT,
                        base_unit=BaseUnit.UNIT,
                        sort_order=30,
                        is_active=False,
                    ),
                )

                first_page = await list_inventory_item_rows(db, q="Paged", limit=1)
                self.assertEqual([item.id for item in first_page.items], [alpha.id])
                self.assertTrue(first_page.has_more)
                self.assertEqual(first_page.items[0].category_ids, [category.id])
                self.assertEqual(first_page.items[0].categories[0].name, "Paged Category")

                second_page = await list_inventory_item_rows(
                    db,
                    q="Paged",
                    limit=1,
                    cursor_sort_order=first_page.next_cursor_sort_order,
                    cursor_name=first_page.next_cursor_name,
                    cursor_id=first_page.next_cursor_id,
                )
                self.assertEqual([item.id for item in second_page.items], [beta.id])

                all_counts = await count_inventory_items(db, q="Paged")
                self.assertEqual(all_counts.all, 3)
                self.assertEqual(all_counts.active, 2)
                self.assertEqual(all_counts.paused, 1)

                active_counts = await count_inventory_items(db, q="Paged", active=True)
                self.assertEqual(active_counts.all, 2)
                self.assertEqual(active_counts.active, 2)
                self.assertEqual(active_counts.paused, 0)

        self.run_async(scenario())

    def test_inventory_stock_rows_page_admin_and_shop_views(self) -> None:
        _actor, shop = self.run_async(
            self.harness.create_shop_user(username="stock-row-shop", shop_name="Stock Row Shop")
        )

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.scalar(select(Shop).where(Shop.id == shop.id))
                category = await create_inventory_category(
                    db, InventoryCategoryCreate(name="Stock Row Category")
                )
                alpha = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Stock Row Alpha",
                        tamil_name="சரக்கு வரிசை அ",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        sort_order=10,
                        category_ids=[category.id],
                    ),
                )
                beta = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Stock Row Beta",
                        tamil_name="சரக்கு வரிசை ஆ",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        sort_order=20,
                        category_ids=[category.id],
                    ),
                )
                gamma = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Stock Row Gamma",
                        tamil_name="சரக்கு வரிசை இ",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        sort_order=30,
                        category_ids=[category.id],
                    ),
                )

                await allocate_shop_inventory_items(db, current_shop, [alpha.id, beta.id])
                await update_shop_inventory_allocation(db, current_shop, beta.id, is_active=False)
                await add_shop_inventory_stock(
                    db,
                    current_shop,
                    alpha.id,
                    InventoryAddRequest(
                        quantity=Decimal("4"),
                        driver_name="Test Driver",
                        vehicle_number="TN01AB1234",
                    ),
                )

                first_page = await list_inventory_stock_rows(
                    db,
                    current_shop,
                    q="Stock Row",
                    include_unallocated=True,
                    limit=2,
                )
                self.assertEqual([item.id for item in first_page.items], [alpha.id, beta.id])
                self.assertTrue(first_page.has_more)
                self.assertTrue(first_page.items[0].allocated)
                self.assertEqual(first_page.items[0].available_quantity, Decimal("4.000"))
                self.assertIsNotNone(first_page.items[0].stock_last_updated_at)
                self.assertEqual(first_page.items[0].category_ids, [category.id])
                self.assertFalse(first_page.items[1].allocation_active)

                second_page = await list_inventory_stock_rows(
                    db,
                    current_shop,
                    q="Stock Row",
                    include_unallocated=True,
                    limit=2,
                    cursor_sort_order=first_page.next_cursor_sort_order,
                    cursor_name=first_page.next_cursor_name,
                    cursor_id=first_page.next_cursor_id,
                )
                self.assertEqual([item.id for item in second_page.items], [gamma.id])
                self.assertFalse(second_page.has_more)
                self.assertFalse(second_page.items[0].allocated)

                shop_page = await list_inventory_stock_rows(
                    db,
                    current_shop,
                    active_allocations_only=True,
                    limit=10,
                )
                self.assertEqual([item.id for item in shop_page.items], [alpha.id])

        self.run_async(scenario())

    def test_inventory_stock_is_isolated_by_branch(self) -> None:
        _actor_a, branch_a = self.run_async(
            self.harness.create_shop_user(username="branch-a", shop_name="Branch A")
        )
        _actor_b, branch_b = self.run_async(
            self.harness.create_shop_user(username="branch-b", shop_name="Branch B")
        )

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_branch_a = session.scalar(select(Shop).where(Shop.id == branch_a.id))
                current_branch_b = session.scalar(select(Shop).where(Shop.id == branch_b.id))
                category = await create_inventory_category(
                    db, InventoryCategoryCreate(name="Branch Usage")
                )
                item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Branch Shared Stock",
                        tamil_name="கிளை சரக்கு",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[category.id],
                    ),
                )

                await allocate_shop_inventory_items(db, current_branch_a, [item.id])
                await allocate_shop_inventory_items(db, current_branch_b, [item.id])
                await add_shop_inventory_stock(
                    db,
                    current_branch_a,
                    item.id,
                    InventoryAddRequest(quantity=Decimal("10"), driver_name="Test Driver", vehicle_number="TN01AB1234"),
                )
                await use_shop_inventory_stock(
                    db,
                    current_branch_a,
                    item.id,
                    InventoryUseRequest(category_id=category.id, quantity=Decimal("3")),
                )

                branch_a_summary = await get_inventory_summary(
                    db, current_branch_a, active_allocations_only=True
                )
                branch_b_summary = await get_inventory_summary(
                    db, current_branch_b, active_allocations_only=True
                )
                branch_a_item = next(row for row in branch_a_summary.items if row.id == item.id)
                branch_b_item = next(row for row in branch_b_summary.items if row.id == item.id)
                self.assertEqual(branch_a_summary.shop_id, branch_a.id)
                self.assertEqual(branch_b_summary.shop_id, branch_b.id)
                self.assertEqual(branch_a_item.available_quantity, Decimal("7.000"))
                self.assertEqual(branch_a_item.used_quantity, Decimal("3.000"))
                self.assertEqual(branch_b_item.available_quantity, Decimal("0"))
                self.assertEqual(branch_b_item.used_quantity, Decimal("0"))

                with self.assertRaises(HTTPException) as branch_b_use_ctx:
                    await use_shop_inventory_stock(
                        db,
                        current_branch_b,
                        item.id,
                        InventoryUseRequest(category_id=category.id, quantity=Decimal("1")),
                    )
                self.assertEqual(branch_b_use_ctx.exception.status_code, 409)

                branch_a_movements = await list_inventory_movements(
                    db, shop_id=current_branch_a.id
                )
                branch_b_movements = await list_inventory_movements(
                    db, shop_id=current_branch_b.id
                )
                self.assertEqual(len(branch_a_movements.items), 2)
                self.assertTrue(
                    all(movement.shop_id == branch_a.id for movement in branch_a_movements.items)
                )
                self.assertEqual(branch_b_movements.items, [])

                await update_shop_inventory_allocation(
                    db, current_branch_b, item.id, is_active=False
                )
                paused_branch_summary = await get_inventory_summary(
                    db, current_branch_b, active_allocations_only=True
                )
                self.assertEqual(paused_branch_summary.items, [])
                with self.assertRaises(HTTPException) as paused_add_ctx:
                    await add_shop_inventory_stock(
                        db,
                        current_branch_b,
                        item.id,
                        InventoryAddRequest(
                            quantity=Decimal("1"),
                            driver_name="Test Driver",
                            vehicle_number="TN01AB1234",
                        ),
                    )
                self.assertEqual(paused_add_ctx.exception.status_code, 422)

        self.run_async(scenario())

    def test_inventory_items_can_be_saved_without_categories(self) -> None:
        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="No Category Stock",
                        tamil_name="வகையில்லா சரக்கு",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                    ),
                )
                self.assertEqual(item.category_ids, [])
                self.assertEqual(item.categories, [])

                listed_item = next(
                    row
                    for row in (
                        await list_inventory_item_rows(db, q="No Category", limit=100)
                    ).items
                    if row.id == item.id
                )
                self.assertEqual(listed_item.category_ids, [])
                self.assertEqual(listed_item.categories, [])

                category = await create_inventory_category(
                    db, InventoryCategoryCreate(name="Optional Category")
                )
                item = await update_inventory_management_item(
                    db,
                    item.id,
                    InventoryItemUpdate(
                        name=item.name,
                        tamil_name=item.tamil_name,
                        unit_type=item.unit_type,
                        base_unit=item.base_unit,
                        category_ids=[category.id],
                    ),
                )
                self.assertEqual(item.category_ids, [category.id])

                item = await update_inventory_management_item(
                    db,
                    item.id,
                    InventoryItemUpdate(
                        name=item.name,
                        tamil_name=item.tamil_name,
                        unit_type=item.unit_type,
                        base_unit=item.base_unit,
                        category_ids=[],
                    ),
                )
                self.assertEqual(item.category_ids, [])

        self.run_async(scenario())

    def test_missing_thumbnail_metadata_is_cleared_and_regenerated(self) -> None:
        self.run_async(self.harness.create_catalogue_items(("Chicken",)))

        original_key = "items/chicken/original/image.jpg"
        missing_thumbnail_key = "items/chicken/thumb/missing.jpg"
        regenerated_thumbnail_key = "items/chicken/thumb/regenerated.jpg"

        async def fake_download_object(object_key, *, fallback_content_type=None):
            self.assertEqual(object_key, original_key)
            return item_storage.StoredImagePayload(
                content=_square_image_bytes(400, "JPEG"),
                content_type=fallback_content_type or "image/jpeg",
                object_key=object_key,
                etag=f'"{object_key}"',
                last_modified=datetime(2026, 5, 31, tzinfo=UTC),
                cache_control=item_storage.PROXY_IMAGE_CACHE_CONTROL,
            )

        async def fake_stream_object(object_key, *, fallback_content_type=None):
            self.assertEqual(object_key, missing_thumbnail_key)
            raise item_storage.StoredImageObjectNotFoundError(object_key)

        async def fake_upload_bytes(**kwargs):
            self.assertEqual(kwargs["variant"], "thumb")
            return regenerated_thumbnail_key, "image/jpeg", '"regenerated-thumb"'

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                chicken = session.scalar(select(Item).where(Item.name == "Chicken"))
                chicken.image_object_key = original_key
                chicken.image_content_type = "image/jpeg"
                chicken.image_thumbnail_object_key = missing_thumbnail_key
                chicken.image_thumbnail_content_type = "image/jpeg"
                session.commit()

                with (
                    patch.object(storage_objects, "_stream_object", fake_stream_object),
                    patch.object(storage_objects, "_download_object", fake_download_object),
                    patch.object(storage_objects, "_upload_bytes", fake_upload_bytes),
                ):
                    payload = await item_storage.get_item_image_response_payload(
                        chicken,
                        db=AsyncSessionAdapter(session),
                        variant="thumb",
                        request_id="test-request-id",
                    )

                self.assertEqual(payload.object_key, regenerated_thumbnail_key)
                session.expire_all()
                refreshed = session.scalar(select(Item).where(Item.name == "Chicken"))
                self.assertEqual(refreshed.image_object_key, original_key)
                self.assertEqual(
                    refreshed.image_thumbnail_object_key,
                    regenerated_thumbnail_key,
                )
                self.assertEqual(refreshed.image_thumbnail_content_type, "image/jpeg")

        self.run_async(scenario())

    def test_missing_original_metadata_is_cleared(self) -> None:
        self.run_async(self.harness.create_catalogue_items(("Chicken",)))

        original_key = "items/chicken/original/missing.jpg"
        thumbnail_key = "items/chicken/thumb/stale.jpg"

        async def fake_stream_object(object_key, *, fallback_content_type=None):
            raise item_storage.StoredImageObjectNotFoundError(object_key)

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                chicken = session.scalar(select(Item).where(Item.name == "Chicken"))
                chicken.image_object_key = original_key
                chicken.image_content_type = "image/jpeg"
                chicken.image_thumbnail_object_key = thumbnail_key
                chicken.image_thumbnail_content_type = "image/jpeg"
                session.commit()

                with (
                    patch.object(storage_objects, "_stream_object", fake_stream_object),
                    self.assertRaises(HTTPException) as ctx,
                ):
                    await item_storage.get_item_image_response_payload(
                        chicken,
                        db=AsyncSessionAdapter(session),
                        variant="original",
                        request_id="test-request-id",
                    )

                self.assertEqual(ctx.exception.status_code, 404)
                session.expire_all()
                refreshed = session.scalar(select(Item).where(Item.name == "Chicken"))
                self.assertIsNone(refreshed.image_object_key)
                self.assertIsNone(refreshed.image_content_type)
                self.assertIsNone(refreshed.image_thumbnail_object_key)
                self.assertIsNone(refreshed.image_thumbnail_content_type)

        self.run_async(scenario())

    def test_item_image_upload_cleans_new_objects_when_commit_fails(self) -> None:
        self.run_async(self.harness.create_catalogue_items(("Chicken",)))
        uploaded_keys: list[str] = []
        deleted_keys: list[str] = []

        async def fake_upload_bytes(**kwargs):
            object_key = f"items/{kwargs['item_id']}/{kwargs['variant']}/uploaded.jpg"
            uploaded_keys.append(object_key)
            return object_key, kwargs["content_type"], f'"{object_key}"'

        async def fake_delete_object(object_key):
            if object_key:
                deleted_keys.append(object_key)

        async def scenario() -> None:
            original_values = (
                item_storage.settings.rustfs_endpoint_url,
                item_storage.settings.rustfs_access_key_id,
                item_storage.settings.rustfs_secret_access_key,
            )
            item_storage.settings.rustfs_endpoint_url = "http://rustfs.test"
            item_storage.settings.rustfs_access_key_id = "access"
            item_storage.settings.rustfs_secret_access_key = "secret"
            try:
                with self.harness.session_factory() as session:
                    chicken = session.scalar(select(Item).where(Item.name == "Chicken"))
                    db = AsyncSessionAdapter(session)

                    async def fail_commit() -> None:
                        raise RuntimeError("commit failed")

                    db.commit = fail_commit
                    with (
                        patch.object(storage_images, "_upload_bytes", fake_upload_bytes),
                        patch.object(storage_images, "_delete_object_if_present", fake_delete_object),
                        self.assertRaises(RuntimeError),
                    ):
                        await item_storage.save_item_image_content(
                            db,
                            chicken,
                            filename="chicken.png",
                            content=_square_image_bytes(),
                            content_type="image/png",
                        )
            finally:
                (
                    item_storage.settings.rustfs_endpoint_url,
                    item_storage.settings.rustfs_access_key_id,
                    item_storage.settings.rustfs_secret_access_key,
                ) = original_values

        self.run_async(scenario())
        self.assertEqual(len(uploaded_keys), 2)
        self.assertEqual(set(deleted_keys), set(uploaded_keys))

    def test_item_image_upload_deletes_stale_objects_after_commit(self) -> None:
        self.run_async(self.harness.create_catalogue_items(("Chicken",)))
        deleted_keys: list[str] = []

        async def fake_upload_bytes(**kwargs):
            object_key = f"items/{kwargs['item_id']}/{kwargs['variant']}/new.jpg"
            return object_key, kwargs["content_type"], f'"{object_key}"'

        async def fake_delete_object(object_key):
            if object_key:
                deleted_keys.append(object_key)

        async def scenario() -> None:
            original_values = (
                item_storage.settings.rustfs_endpoint_url,
                item_storage.settings.rustfs_access_key_id,
                item_storage.settings.rustfs_secret_access_key,
            )
            item_storage.settings.rustfs_endpoint_url = "http://rustfs.test"
            item_storage.settings.rustfs_access_key_id = "access"
            item_storage.settings.rustfs_secret_access_key = "secret"
            try:
                with self.harness.session_factory() as session:
                    chicken = session.scalar(select(Item).where(Item.name == "Chicken"))
                    chicken.image_object_key = "items/chicken/original/old.jpg"
                    chicken.image_content_type = "image/jpeg"
                    chicken.image_thumbnail_object_key = "items/chicken/thumb/old.jpg"
                    chicken.image_thumbnail_content_type = "image/jpeg"
                    session.commit()

                    with (
                        patch.object(storage_images, "_upload_bytes", fake_upload_bytes),
                        patch.object(storage_images, "_delete_object_if_present", fake_delete_object),
                    ):
                        result = await item_storage.save_item_image_content(
                            AsyncSessionAdapter(session),
                            chicken,
                            filename="chicken.png",
                            content=_square_image_bytes(),
                            content_type="image/png",
                        )

                    self.assertIsNotNone(result.image_path)
                    self.assertIsNotNone(result.image_thumb_path)
            finally:
                (
                    item_storage.settings.rustfs_endpoint_url,
                    item_storage.settings.rustfs_access_key_id,
                    item_storage.settings.rustfs_secret_access_key,
                ) = original_values

        self.run_async(scenario())
        self.assertEqual(
            set(deleted_keys),
            {"items/chicken/original/old.jpg", "items/chicken/thumb/old.jpg"},
        )

    def test_legacy_database_images_migrate_to_rustfs_and_clear_bytes(self) -> None:
        self.run_async(self.harness.create_catalogue_items(("Chicken", "Duck")))
        upload_calls = []

        async def fake_upload_bytes(**kwargs):
            upload_calls.append(kwargs)
            object_key = f"items/{kwargs['item_id']}/migrated.jpg"
            return object_key, kwargs["content_type"], f'"{object_key}"'

        async def scenario() -> None:
            original_values = (
                item_storage.settings.rustfs_endpoint_url,
                item_storage.settings.rustfs_access_key_id,
                item_storage.settings.rustfs_secret_access_key,
            )
            item_storage.settings.rustfs_endpoint_url = "http://rustfs.test"
            item_storage.settings.rustfs_access_key_id = "access"
            item_storage.settings.rustfs_secret_access_key = "secret"
            try:
                with self.harness.session_factory() as session:
                    session.execute(text("ALTER TABLE items ADD COLUMN image_data BLOB"))
                    chicken = session.scalar(select(Item).where(Item.name == "Chicken"))
                    duck = session.scalar(select(Item).where(Item.name == "Duck"))
                    chicken_raw_id = session.execute(
                        text("SELECT id FROM items WHERE name = :name"), {"name": chicken.name}
                    ).scalar_one()
                    duck_raw_id = session.execute(
                        text("SELECT id FROM items WHERE name = :name"), {"name": duck.name}
                    ).scalar_one()
                    session.execute(
                        text(
                            """
                            UPDATE items
                            SET image_data = :image_data,
                                image_content_type = :content_type
                            WHERE id = :item_id
                            """
                        ),
                        {
                            "image_data": b"legacy-chicken",
                            "content_type": "image/jpeg",
                            "item_id": chicken_raw_id,
                        },
                    )
                    session.execute(
                        text(
                            """
                            UPDATE items
                            SET image_data = :image_data,
                                image_object_key = :image_object_key,
                                image_content_type = :content_type
                            WHERE id = :item_id
                            """
                        ),
                        {
                            "image_data": b"legacy-duck",
                            "image_object_key": f"items/{duck_raw_id}/existing.jpg",
                            "content_type": "image/jpeg",
                            "item_id": duck_raw_id,
                        },
                    )
                    session.commit()

                    with patch.object(storage_objects, "_upload_bytes", fake_upload_bytes):
                        migrated_count = await item_storage.migrate_item_image_data_to_rustfs(
                            AsyncSessionAdapter(session)
                        )
                    self.assertEqual(migrated_count, 2)
                    self.assertEqual(len(upload_calls), 1)

                    rows = (
                        session.execute(
                            text(
                                """
                                SELECT id, image_data, image_object_key, image_content_type
                                FROM items
                                WHERE id IN (:chicken_id, :duck_id)
                                """
                            ),
                            {"chicken_id": chicken_raw_id, "duck_id": duck_raw_id},
                        )
                        .mappings()
                        .all()
                    )
                    rows_by_id = {str(row["id"]): row for row in rows}
                    self.assertIsNone(rows_by_id[str(chicken_raw_id)]["image_data"])
                    self.assertEqual(
                        rows_by_id[str(chicken_raw_id)]["image_object_key"],
                        f"items/{chicken_raw_id}/migrated.jpg",
                    )
                    self.assertIsNone(rows_by_id[str(duck_raw_id)]["image_data"])
                    self.assertEqual(
                        rows_by_id[str(duck_raw_id)]["image_object_key"],
                        f"items/{duck_raw_id}/existing.jpg",
                    )
            finally:
                (
                    item_storage.settings.rustfs_endpoint_url,
                    item_storage.settings.rustfs_access_key_id,
                    item_storage.settings.rustfs_secret_access_key,
                ) = original_values

        self.run_async(scenario())

    def test_create_daily_prices_requires_all_active_items(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_items_for_shop(shop.id, ("Chicken", "Duck")))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                items = session.scalars(
                    select(Item)
                    .where(Item.is_active.is_(True), Item.shop_id == shop.id)
                    .order_by(Item.id)
                ).all()
                db = AsyncSessionAdapter(session)
                payload = DailyPriceCreate(
                    entries=[
                        DailyPriceEntry(
                            item_id=items[0].id, price_per_unit=Decimal("120.00")
                        )
                    ]
                )
                with self.assertRaises(HTTPException) as ctx:
                    await create_daily_prices(db, shop, payload)
                self.assertEqual(ctx.exception.status_code, 422)
                self.assertEqual(
                    ctx.exception.detail,
                    "Prices must be provided for every active item",
                )

        self.run_async(scenario())

    def test_item_schema_rejects_invalid_unit_pair(self) -> None:
        with self.assertRaises(ValueError):
            ItemCreate(
                name="Egg",
                tamil_name="முட்டை",
                unit_type=UnitType.COUNT,
                base_unit=BaseUnit.KG,
            )

    def test_create_item_rejects_duplicate_catalogue_name(self) -> None:
        async def scenario() -> None:
            org = await self.harness.create_default_organization()
            payload = ItemCreate(
                name="Duplicate Chicken",
                tamil_name="நகல் கோழி",
                unit_type=UnitType.WEIGHT,
                base_unit=BaseUnit.KG,
            )
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                await create_item(db, payload, organization_id=org.id)
                with self.assertRaises(HTTPException) as duplicate_context:
                    await create_item(db, payload, organization_id=org.id)
                self.assertEqual(duplicate_context.exception.status_code, 409)
                self.assertEqual(duplicate_context.exception.detail, "Item name already exists")

        self.run_async(scenario())

    def test_shop_bootstrap_requires_admin_publish_for_billing(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(
            self.harness.create_prices_for_shop(
                shop.id,
                date.today(),
                {"Chicken": "100.00"},
            )
        )

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.get(Shop, shop.id)
                current_shop.daily_prices_published_on = None
                session.commit()

                unpublished = await get_shop_bootstrap(db, current_shop)
                self.assertFalse(unpublished.prices_set)

                chicken = session.scalar(
                    select(Item).where(Item.name == "Chicken", Item.shop_id == shop.id)
                )
                await create_daily_prices(
                    db,
                    current_shop,
                    DailyPriceCreate(
                        entries=[
                            DailyPriceEntry(
                                item_id=chicken.id,
                                price_per_unit=Decimal("100.00"),
                            )
                        ]
                    ),
                    publish=True,
                )
                published = await get_shop_bootstrap(db, current_shop)
                self.assertTrue(published.prices_set)

        self.run_async(scenario())

    def test_global_bootstrap_requires_every_item_priced_today(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_catalogue_items(("Chicken", "Duck")))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                item = session.scalar(select(Item).where(Item.shop_id.is_(None), Item.is_active.is_(True)))
                session.add(
                    DailyPrice(
                        shop_id=shop.id,
                        item_id=item.id,
                        price_per_unit=Decimal("120.00"),
                        unit=item.base_unit,
                        price_date=date.today(),
                    )
                )
                session.commit()

                bootstrap = await get_global_bootstrap(AsyncSessionAdapter(session))
                self.assertFalse(bootstrap.prices_set)

        self.run_async(scenario())

    def test_shop_price_history_uses_exact_selected_date(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_items_for_shop(shop.id, ("Chicken", "Duck")))
        target_date = date.today() - timedelta(days=1)

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                chicken = session.scalar(
                    select(Item).where(Item.name == "Chicken", Item.shop_id == shop.id)
                )
                duck = session.scalar(
                    select(Item).where(Item.name == "Duck", Item.shop_id == shop.id)
                )
                session.add_all(
                    [
                        DailyPrice(
                            shop_id=shop.id,
                            item_id=chicken.id,
                            price_per_unit=Decimal("120.00"),
                            unit=chicken.base_unit,
                            price_date=target_date,
                        ),
                        DailyPrice(
                            shop_id=shop.id,
                            item_id=chicken.id,
                            price_per_unit=Decimal("140.00"),
                            unit=chicken.base_unit,
                            price_date=date.today(),
                        ),
                        DailyPrice(
                            shop_id=shop.id,
                            item_id=duck.id,
                            price_per_unit=Decimal("220.00"),
                            unit=duck.base_unit,
                            price_date=date.today(),
                        ),
                    ]
                )
                session.commit()

                history = await get_shop_price_history(
                    AsyncSessionAdapter(session), shop, target_date
                )
                items_by_name = {item.item_name: item for item in history.items}

                self.assertEqual(history.price_date, target_date)
                self.assertFalse(history.prices_set)
                self.assertEqual(
                    items_by_name["Chicken"].current_price, Decimal("120.00")
                )
                self.assertEqual(
                    items_by_name["Chicken"].latest_price_date, target_date
                )
                self.assertEqual(items_by_name["Chicken"].price_status, PriceStatus.STALE)
                self.assertIsNone(items_by_name["Duck"].current_price)
                self.assertIsNone(items_by_name["Duck"].latest_price_date)
                self.assertEqual(items_by_name["Duck"].price_status, PriceStatus.MISSING)

        self.run_async(scenario())

    def test_create_global_daily_prices_requires_active_shops(self) -> None:
        self.run_async(self.harness.create_admin_user())
        self.run_async(self.harness.create_catalogue_items(("Chicken",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                items = session.scalars(
                    select(Item).where(Item.is_active.is_(True)).order_by(Item.id)
                ).all()
                db = AsyncSessionAdapter(session)
                payload = DailyPriceCreate(
                    entries=[
                        DailyPriceEntry(
                            item_id=item.id, price_per_unit=Decimal("150.00")
                        )
                        for item in items
                    ]
                )
                with self.assertRaises(HTTPException) as ctx:
                    await create_global_daily_prices(db, payload)
                self.assertEqual(ctx.exception.status_code, 422)
                self.assertEqual(
                    ctx.exception.detail, "No active shops to apply global prices to"
                )

        self.run_async(scenario())

    def test_create_global_daily_prices_rejects_duplicate_items(self) -> None:
        self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_catalogue_items(("Chicken",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                items = session.scalars(
                    select(Item).where(Item.is_active.is_(True)).order_by(Item.id)
                ).all()
                db = AsyncSessionAdapter(session)
                payload = DailyPriceCreate(
                    entries=[
                        DailyPriceEntry(
                            item_id=items[0].id, price_per_unit=Decimal("150.00")
                        ),
                        DailyPriceEntry(
                            item_id=items[0].id, price_per_unit=Decimal("175.00")
                        ),
                    ]
                )
                with self.assertRaises(HTTPException) as ctx:
                    await create_global_daily_prices(db, payload)
                self.assertEqual(ctx.exception.status_code, 422)
                self.assertEqual(
                    ctx.exception.detail,
                    f"Duplicate price entry for item {items[0].id}",
                )

        self.run_async(scenario())

    def test_create_bill_rejects_fractional_count_item_quantities(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(
            self.harness.create_prices_for_shop(
                shop.id,
                date.today(),
                {
                    "Duck": "200.00",
                },
            )
        )

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                duck = session.scalar(select(Item).where(Item.name == "Duck", Item.shop_id == shop.id))
                db = AsyncSessionAdapter(session)
                payload = BillCheckoutRequest(
                    items=[BillItemInput(item_id=duck.id, quantity=Decimal("1.5"))],
                    payment=CheckoutPaymentInput(
                        cash_amount=Decimal("300.00"), upi_amount=Decimal("0.00")
                    ),
                )
                with self.assertRaises(HTTPException) as ctx:
                    await preview_bill(db, shop, payload)
                self.assertEqual(ctx.exception.status_code, 422)
                self.assertEqual(
                    ctx.exception.detail, "Duck only accepts integer unit quantities"
                )

        self.run_async(scenario())

    def test_create_bill_rejects_underpayment(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(
            self.harness.create_prices_for_shop(
                shop.id,
                date.today(),
                {
                    "Chicken": "100.00",
                },
            )
        )

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                chicken = session.scalar(select(Item).where(Item.name == "Chicken", Item.shop_id == shop.id))
                db = AsyncSessionAdapter(session)
                payload = BillCheckoutRequest(
                    items=[BillItemInput(item_id=chicken.id, quantity=Decimal("2"))],
                    payment=CheckoutPaymentInput(
                        cash_amount=Decimal("150.00"), upi_amount=Decimal("0.00")
                    ),
                )
                with self.assertRaises(HTTPException) as ctx:
                    await preview_bill(db, shop, payload)
                self.assertEqual(ctx.exception.status_code, 422)
                self.assertEqual(
                    ctx.exception.detail, "Payment pending. Balance: 50.00"
                )

        self.run_async(scenario())

    def test_create_bill_persists_paid_bill(self) -> None:
        actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(
            self.harness.create_prices_for_shop(
                shop.id,
                date.today(),
                {
                    "Chicken": "100.00",
                },
            )
        )

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                chicken = session.scalar(select(Item).where(Item.name == "Chicken", Item.shop_id == shop.id))
                db = AsyncSessionAdapter(session)
                payload = BillCheckoutRequest(
                    items=[BillItemInput(item_id=chicken.id, quantity=Decimal("2"))],
                    payment=CheckoutPaymentInput(
                        cash_amount=Decimal("200.00"), upi_amount=Decimal("0.00")
                    ),
                )
                preview = await preview_bill(db, shop, payload)
                self.assertIsNone(session.scalar(select(Bill).limit(1)))
                self.assertIsNone(preview.bill_no)

                stored_actor = session.get(User, actor.id)
                created = await create_bill(
                    db,
                    shop,
                    BillCheckoutCommitRequest(
                        items=payload.items,
                        payment=payload.payment,
                        checkout_token=preview.checkout_token,
                    ),
                    actor=stored_actor,
                )
                bill = created.bill
                self.assertTrue(created.created)
                self.assertEqual(bill.status, "paid")
                self.assertEqual(bill.total_amount, Decimal("200.00"))
                self.assertEqual(bill.payment.total_paid, Decimal("200.00"))
                self.assertIsNotNone(bill.bill_no)

                stored_shop = session.get(Shop, shop.id)
                self.assertIsNotNone(stored_shop)
                self.assertIsNotNone(stored_actor)

        self.run_async(scenario())

    def test_create_bill_records_assumption_inventory_use_after_preview(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_catalogue_items(("Chicken",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.get(Shop, shop.id)
                chicken = session.scalar(select(Item).where(Item.name == "Chicken", Item.shop_id.is_(None)))
                await allocate_catalogue_item(db, current_shop, chicken.id)
                category = await create_inventory_category(
                    db,
                    InventoryCategoryCreate(name="Kitchen Use"),
                )
                inventory_item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Chicken Stock",
                        tamil_name="கோழி இருப்பு",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[category.id],
                    ),
                )
                await allocate_shop_inventory_items(db, current_shop, [inventory_item.id])
                await add_shop_inventory_stock(
                    db,
                    current_shop,
                    inventory_item.id,
                    InventoryAddRequest(quantity=Decimal("20"), driver_name="Test Driver", vehicle_number="TN01AB1234"),
                )
                await update_item_assumption(
                    db,
                    chicken.id,
                    ItemAssumptionUpdate(
                        assumption_percent=Decimal("78"),
                        assumption_inventory_item_id=inventory_item.id,
                        assumption_inventory_category_id=category.id,
                    ),
                )
                await create_daily_prices(
                    db,
                    current_shop,
                    DailyPriceCreate(
                        entries=[
                            DailyPriceEntry(
                                item_id=chicken.id,
                                price_per_unit=Decimal("120.00"),
                            )
                        ]
                    ),
                    publish=True,
                )

                payload = BillCheckoutRequest(
                    items=[BillItemInput(item_id=chicken.id, quantity=Decimal("10"))],
                    payment=CheckoutPaymentInput(
                        cash_amount=Decimal("1200.00"),
                        upi_amount=Decimal("0.00"),
                    ),
                )
                preview = await preview_bill(db, current_shop, payload)
                movements_after_preview = await list_inventory_movements(
                    db,
                    shop_id=current_shop.id,
                    limit=10,
                )
                self.assertFalse(
                    any(
                        movement.movement_type == InventoryMovementType.USE
                        for movement in movements_after_preview.items
                    )
                )

                created = await create_bill(
                    db,
                    current_shop,
                    BillCheckoutCommitRequest(
                        items=payload.items,
                        payment=payload.payment,
                        checkout_token=preview.checkout_token,
                    ),
                )
                self.assertEqual(created.bill.items[0].quantity, Decimal("10"))
                movements_after_commit = await list_inventory_movements(
                    db,
                    shop_id=current_shop.id,
                    limit=10,
                )
                use_movements = [
                    movement
                    for movement in movements_after_commit.items
                    if movement.movement_type == InventoryMovementType.USE
                ]
                self.assertEqual(len(use_movements), 1)
                self.assertEqual(use_movements[0].quantity, Decimal("7.800"))
                self.assertEqual(use_movements[0].inventory_item_id, inventory_item.id)
                self.assertEqual(use_movements[0].category_id, category.id)

        self.run_async(scenario())

    def test_preview_bill_has_no_bill_no_and_pending_receipt_on_commit(self) -> None:
        actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(
            self.harness.create_prices_for_shop(
                shop.id,
                date.today(),
                {"Chicken": "100.00"},
            )
        )

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                chicken = session.scalar(
                    select(Item).where(Item.name == "Chicken", Item.shop_id == shop.id)
                )
                db = AsyncSessionAdapter(session)
                stored_actor = session.get(User, actor.id)
                payload = BillCheckoutRequest(
                    items=[BillItemInput(item_id=chicken.id, quantity=Decimal("1"))],
                    payment=CheckoutPaymentInput(
                        cash_amount=Decimal("100.00"), upi_amount=Decimal("0.00")
                    ),
                )
                preview = await preview_bill(db, shop, payload)
                self.assertIsNone(preview.bill_no)

                first = await create_bill(
                    db,
                    shop,
                    BillCheckoutCommitRequest(
                        items=payload.items,
                        payment=payload.payment,
                        checkout_token=preview.checkout_token,
                    ),
                    actor=stored_actor,
                )
                self.assertTrue(first.created)
                self.assertEqual(first.bill.receipt.receipt_status, ReceiptStatus.PENDING)
                self.assertIsNone(first.bill.receipt.printed_at)

                second = await create_bill(
                    db,
                    shop,
                    BillCheckoutCommitRequest(
                        items=payload.items,
                        payment=payload.payment,
                        checkout_token=preview.checkout_token,
                    ),
                    actor=stored_actor,
                )
                self.assertFalse(second.created)
                self.assertEqual(second.bill.id, first.bill.id)

                updated = await update_bill_receipt_status(
                    db,
                    shop,
                    first.bill.id,
                    BillReceiptStatusUpdate(status=ReceiptStatus.PRINTED),
                )
                self.assertEqual(updated.receipt.receipt_status, ReceiptStatus.PRINTED)
                self.assertIsNotNone(updated.receipt.printed_at)

        self.run_async(scenario())

    def test_list_shop_bills_pagination_and_receipt_filter(self) -> None:
        actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(
            self.harness.create_prices_for_shop(
                shop.id,
                date.today(),
                {"Chicken": "50.00"},
            )
        )

        async def scenario() -> None:
            from app.services.shop_billing import list_shop_bills

            with self.harness.session_factory() as session:
                chicken = session.scalar(
                    select(Item).where(Item.name == "Chicken", Item.shop_id == shop.id)
                )
                db = AsyncSessionAdapter(session)
                stored_actor = session.get(User, actor.id)
                current_shop = session.get(Shop, shop.id)
                payload = BillCheckoutRequest(
                    items=[BillItemInput(item_id=chicken.id, quantity=Decimal("1"))],
                    payment=CheckoutPaymentInput(
                        cash_amount=Decimal("50.00"), upi_amount=Decimal("0.00")
                    ),
                )
                preview = await preview_bill(db, current_shop, payload)
                await create_bill(
                    db,
                    current_shop,
                    BillCheckoutCommitRequest(
                        items=payload.items,
                        payment=payload.payment,
                        checkout_token=preview.checkout_token,
                    ),
                    actor=stored_actor,
                )

                page = await list_shop_bills(db, current_shop, page=1, page_size=10)
                self.assertEqual(page.total_count, 1)
                self.assertEqual(len(page.items), 1)
                self.assertEqual(page.items[0].receipt_status, ReceiptStatus.PENDING)

                pending_only = await list_shop_bills(
                    db,
                    current_shop,
                    receipt_status=ReceiptStatus.PENDING,
                )
                self.assertEqual(pending_only.total_count, 1)

        self.run_async(scenario())

    def test_repeated_commit_with_same_token_does_not_duplicate_bill_rows(self) -> None:
        actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(
            self.harness.create_prices_for_shop(
                shop.id,
                date.today(),
                {"Chicken": "80.00"},
            )
        )

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                chicken = session.scalar(
                    select(Item).where(Item.name == "Chicken", Item.shop_id == shop.id)
                )
                db = AsyncSessionAdapter(session)
                stored_actor = session.get(User, actor.id)
                current_shop = session.get(Shop, shop.id)
                payload = BillCheckoutRequest(
                    items=[BillItemInput(item_id=chicken.id, quantity=Decimal("1"))],
                    payment=CheckoutPaymentInput(
                        cash_amount=Decimal("80.00"), upi_amount=Decimal("0.00")
                    ),
                )
                preview = await preview_bill(db, current_shop, payload)
                commit_request = BillCheckoutCommitRequest(
                    items=payload.items,
                    payment=payload.payment,
                    checkout_token=preview.checkout_token,
                )
                for _ in range(5):
                    await create_bill(
                        db,
                        current_shop,
                        commit_request,
                        actor=stored_actor,
                    )
                bill_count = session.scalar(select(func.count()).select_from(Bill))
                self.assertEqual(bill_count, 1)

        self.run_async(scenario())

    def test_sequential_checkouts_allocate_unique_bill_numbers(self) -> None:
        actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(
            self.harness.create_prices_for_shop(
                shop.id,
                date.today(),
                {"Chicken": "60.00"},
            )
        )

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                chicken = session.scalar(
                    select(Item).where(Item.name == "Chicken", Item.shop_id == shop.id)
                )
                db = AsyncSessionAdapter(session)
                stored_actor = session.get(User, actor.id)
                current_shop = session.get(Shop, shop.id)
                bill_numbers: list[str] = []
                for _ in range(3):
                    payload = BillCheckoutRequest(
                        items=[BillItemInput(item_id=chicken.id, quantity=Decimal("1"))],
                        payment=CheckoutPaymentInput(
                            cash_amount=Decimal("60.00"), upi_amount=Decimal("0.00")
                        ),
                    )
                    preview = await preview_bill(db, current_shop, payload)
                    created = await create_bill(
                        db,
                        current_shop,
                        BillCheckoutCommitRequest(
                            items=payload.items,
                            payment=payload.payment,
                            checkout_token=preview.checkout_token,
                        ),
                        actor=stored_actor,
                    )
                    bill_numbers.append(created.bill.bill_no)
                self.assertEqual(len(set(bill_numbers)), 3)

        self.run_async(scenario())

    def test_inventory_backdate_policy_and_point_in_time_stock(self) -> None:
        shop_actor, shop = self.run_async(self.harness.create_shop_user())
        admin_user = self.run_async(self.harness.create_admin_user())

        async def scenario() -> None:
            from app.models.inventory_policy import InventoryBackdatePolicy
            from app.services.inventory import _available_quantity_at
            from app.services.inventory_backdate import assert_inventory_occurred_at_allowed
            from app.services.inventory_policy import update_inventory_backdate_policy
            from app.schemas.inventory_policy import InventoryBackdatePolicyUpdate

            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.scalar(select(Shop).where(Shop.id == shop.id))
                category = await create_inventory_category(
                    db, InventoryCategoryCreate(name="Fresh")
                )
                _ = category
                item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Backdate Chicken",
                        tamil_name="சிக்கன்",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[],
                    ),
                )
                await allocate_shop_inventory_items(db, current_shop, [item.id])

                policy = InventoryBackdatePolicy(
                    id=1,
                    allow_shop_backdated_inventory=False,
                    shop_backdate_window_days=0,
                )
                yesterday = datetime.now(UTC) - timedelta(days=1)
                with self.assertRaises(HTTPException) as denied:
                    assert_inventory_occurred_at_allowed(
                        actor=shop_actor,
                        occurred_at=yesterday,
                        policy=policy,
                    )
                self.assertEqual(denied.exception.status_code, 422)

                policy.allow_shop_backdated_inventory = True
                policy.shop_backdate_window_days = 3
                assert_inventory_occurred_at_allowed(
                    actor=shop_actor,
                    occurred_at=yesterday,
                    policy=policy,
                )

                await update_inventory_backdate_policy(
                    db,
                    InventoryBackdatePolicyUpdate(
                        allow_shop_backdated_inventory=True,
                        shop_backdate_window_days=7,
                    ),
                )

                past_add = datetime.now(UTC) - timedelta(days=2)
                await add_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryAddRequest(
                        quantity=Decimal("10"),
                        driver_name="Driver",
                        vehicle_number="TN01AB1234",
                        occurred_at=past_add,
                    ),
                    actor=shop_actor,
                )
                self.assertEqual(
                    await _available_quantity_at(db, current_shop.id, item.id, as_of=past_add),
                    Decimal("10.000"),
                )

                with self.assertRaises(HTTPException) as use_denied:
                    await use_shop_inventory_stock(
                        db,
                        current_shop,
                        item.id,
                        InventoryUseRequest(
                            quantity=Decimal("5"),
                            occurred_at=past_add - timedelta(hours=1),
                        ),
                        actor=shop_actor,
                    )
                self.assertEqual(use_denied.exception.status_code, 409)

                await add_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryAddRequest(
                        quantity=Decimal("10"),
                        driver_name="Driver",
                        vehicle_number="TN01AB1234",
                    ),
                    actor=admin_user,
                )
                self.assertEqual(
                    await _available_quantity_at(db, current_shop.id, item.id, as_of=datetime.now(UTC)),
                    Decimal("20.000"),
                )

        self.run_async(scenario())

    def test_delete_inventory_category_blocked_by_retailer_usage_history(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.scalar(select(Shop).where(Shop.id == shop.id))
                category = await create_inventory_category(db, InventoryCategoryCreate(name="Used Cat"))
                spare_category = await create_inventory_category(
                    db, InventoryCategoryCreate(name="Spare Cat")
                )
                item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Retailer Stock Item",
                        tamil_name="சரக்கு",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[category.id],
                    ),
                )
                await allocate_shop_inventory_items(db, current_shop, [item.id])
                await add_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryAddRequest(
                        quantity=Decimal("20"),
                        driver_name="Driver",
                        vehicle_number="TN01AB1234",
                    ),
                )
                retailer = await create_retailer(db, RetailerCreate(name="Corner Shop"))
                await sync_retailer_branch_allocations(db, retailer.id, [current_shop.id])
                await record_retailer_inventory_usages_bulk(
                    db,
                    current_shop,
                    RetailerInventoryUsageBulkCreate(
                        retailer_id=retailer.id,
                        lines=[
                            RetailerInventoryUsageLine(
                                inventory_item_id=item.id,
                                category_id=category.id,
                                quantity=Decimal("1"),
                            )
                        ],
                    ),
                    actor=_actor,
                )
                await update_inventory_management_item(
                    db,
                    item.id,
                    InventoryItemUpdate(
                        name=item.name,
                        tamil_name=item.tamil_name,
                        unit_type=item.unit_type,
                        base_unit=item.base_unit,
                        category_ids=[spare_category.id],
                    ),
                )
                with self.assertRaises(HTTPException) as blocked_ctx:
                    await delete_inventory_category(db, category.id)
                self.assertEqual(blocked_ctx.exception.status_code, 409)
                self.assertEqual(
                    blocked_ctx.exception.detail,
                    "Cannot delete an inventory category with retailer usage history",
                )

        self.run_async(scenario())

    def test_retailer_inventory_usage_reduces_available_not_use(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.scalar(select(Shop).where(Shop.id == shop.id))
                category = await create_inventory_category(db, InventoryCategoryCreate(name="R1"))
                item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Retailer Stock Item",
                        tamil_name="சரக்கு",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[category.id],
                    ),
                )
                await allocate_shop_inventory_items(db, current_shop, [item.id])
                await add_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryAddRequest(
                        quantity=Decimal("20"),
                        driver_name="Driver",
                        vehicle_number="TN01AB1234",
                    ),
                )
                retailer = await create_retailer(db, RetailerCreate(name="Corner Shop"))
                await sync_retailer_branch_allocations(db, retailer.id, [current_shop.id])

                result = await record_retailer_inventory_usages_bulk(
                    db,
                    current_shop,
                    RetailerInventoryUsageBulkCreate(
                        retailer_id=retailer.id,
                        lines=[
                            RetailerInventoryUsageLine(
                                inventory_item_id=item.id,
                                category_id=category.id,
                                quantity=Decimal("4"),
                            )
                        ],
                    ),
                    actor=_actor,
                )
                stock_item = next(row for row in result.summary.items if row.id == item.id)
                self.assertEqual(stock_item.available_quantity, Decimal("16.000"))
                self.assertEqual(stock_item.used_quantity, Decimal("0"))
                self.assertEqual(stock_item.retailer_used_quantity, Decimal("4.000"))

                with self.assertRaises(HTTPException) as over_ctx:
                    await record_retailer_inventory_usages_bulk(
                        db,
                        current_shop,
                        RetailerInventoryUsageBulkCreate(
                            retailer_id=retailer.id,
                            lines=[
                                RetailerInventoryUsageLine(
                                    inventory_item_id=item.id,
                                    category_id=category.id,
                                    quantity=Decimal("20"),
                                )
                            ],
                        ),
                        actor=_actor,
                    )
                self.assertEqual(over_ctx.exception.status_code, 409)

                adjusted = await admin_set_retailer_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    RetailerStockAdjustRequest(
                        retailer_used_quantity=Decimal("6"),
                        category_id=category.id,
                        adjustment_reason="Correction",
                    ),
                    actor=_actor,
                )
                self.assertEqual(adjusted.retailer_used_quantity, Decimal("6.000"))
                self.assertEqual(adjusted.available_quantity, Decimal("14.000"))

                history = await list_retailer_inventory_usages(
                    db,
                    shop_id=current_shop.id,
                    limit=10,
                )
                self.assertGreaterEqual(len(history.items), 2)

        self.run_async(scenario())

    def test_retailer_inventory_requires_branch_allocation(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.scalar(select(Shop).where(Shop.id == shop.id))
                item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Guard Item",
                        tamil_name="காவல்",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                    ),
                )
                await allocate_shop_inventory_items(db, current_shop, [item.id])
                await add_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryAddRequest(
                        quantity=Decimal("5"),
                        driver_name="Driver",
                        vehicle_number="TN01AB1234",
                    ),
                )
                retailer = await create_retailer(db, RetailerCreate(name="Unassigned"))

                with self.assertRaises(HTTPException) as denied:
                    await record_retailer_inventory_usages_bulk(
                        db,
                        current_shop,
                        RetailerInventoryUsageBulkCreate(
                            retailer_id=retailer.id,
                            lines=[
                                RetailerInventoryUsageLine(
                                    inventory_item_id=item.id,
                                    quantity=Decimal("1"),
                                )
                            ],
                        ),
                        actor=_actor,
                    )
                self.assertEqual(denied.exception.status_code, 422)

        self.run_async(scenario())
