"""Unit tests for admin Purchase PDF report section."""

from __future__ import annotations

from decimal import Decimal
from io import BytesIO

from app.core.ids import uuid7
from app.core.timezone import today_ist
from app.models import (
    BaseUnit,
    InventoryItemPurchaseRateHistory,
    Shop,
    UnitType,
)
from app.schemas.inventory import (
    InventoryAddRequest,
    InventoryItemCreate,
    InventoryItemPurchaseRateUpdate,
)
from app.schemas.purchaser import PurchaserCreate
from app.services.inventory import (
    add_shop_inventory_stock,
    allocate_shop_inventory_items,
    create_inventory_item as create_inventory_management_item,
    update_inventory_item_purchase_rate,
)
from app.services.purchasers import create_purchaser
from app.services.reports import generate_admin_report_pdf
from test.support import AsyncSessionAdapter, BackendTestCase


def _pdf_text(report) -> str:
    from pypdf import PdfReader

    data = report.file.read()
    return " ".join(
        "\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(data)).pages).split()
    )


class PurchaseReportTests(BackendTestCase):
    def test_purchase_report_rows_filter_rate_and_totals(self) -> None:
        admin_user = self.ensure_admin_user()
        _actor, shop = self.run_async(self.harness.create_shop_user(shop_name="Purchase Branch"))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.get(Shop, shop.id)
                assert current_shop is not None

                purchaser_a = await create_purchaser(
                    db,
                    PurchaserCreate(name="Farm A", tamil_name="பண்ணை ஏ"),
                    user_id=admin_user.id,
                )
                purchaser_b = await create_purchaser(
                    db,
                    PurchaserCreate(name="Farm B", tamil_name="பண்ணை பி"),
                    user_id=admin_user.id,
                )

                item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Live Chicken",
                        tamil_name="உயிருடன் கோழி",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[],
                        billing_item_ids=[],
                        purchase_rate=Decimal("100.00"),
                    ),
                )
                await allocate_shop_inventory_items(db, current_shop, [item.id])

                today = today_ist()
                session.add(
                    InventoryItemPurchaseRateHistory(
                        id=uuid7(),
                        inventory_item_id=item.id,
                        purchase_rate=Decimal("90.00"),
                        date=today,
                    )
                )
                session.flush()

                await add_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryAddRequest(
                        quantity=Decimal("10.00"),
                        bird_count=20,
                        driver_name="Driver A",
                        vehicle_number="TN01AA1111",
                        purchaser_id=purchaser_a.id,
                    ),
                )
                await add_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryAddRequest(
                        quantity=Decimal("5.00"),
                        bird_count=8,
                        driver_name="Driver B",
                        vehicle_number="TN01BB2222",
                        purchaser_id=purchaser_b.id,
                    ),
                )

                # Current rate differs from history — report must prefer history for today.
                await update_inventory_item_purchase_rate(
                    db,
                    item.id,
                    InventoryItemPurchaseRateUpdate(purchase_rate=Decimal("120.00")),
                )

                report = await generate_admin_report_pdf(
                    db,
                    sections=["purchase"],
                    period="date",
                    reference_date=today,
                    shop_ids=[current_shop.id],
                    organization_id=current_shop.organization_id,
                )
                try:
                    text = _pdf_text(report)
                    self.assertIn("Purchase Report", text)
                    self.assertIn("Farm A", text)
                    self.assertIn("Farm B", text)
                    self.assertIn("Total Kg", text)
                    self.assertIn("15.00", text)
                    # 10*90 + 5*90 = 1350
                    self.assertIn("1350.00", text)
                    self.assertNotIn("120.00", text)
                finally:
                    report.file.close()

                filtered = await generate_admin_report_pdf(
                    db,
                    sections=["purchase"],
                    period="date",
                    reference_date=today,
                    shop_ids=[current_shop.id],
                    purchaser_ids=[purchaser_a.id],
                    organization_id=current_shop.organization_id,
                )
                try:
                    text = _pdf_text(filtered)
                    self.assertIn("Farm A", text)
                    self.assertNotIn("Farm B", text)
                    self.assertIn("10.00", text)
                    # 10 * 90
                    self.assertIn("900.00", text)
                finally:
                    filtered.file.close()

        self.run_async(scenario())

    def test_purchase_report_falls_back_to_current_rate(self) -> None:
        admin_user = self.ensure_admin_user()
        _actor, shop = self.run_async(self.harness.create_shop_user(shop_name="Fallback Branch"))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.get(Shop, shop.id)
                assert current_shop is not None

                purchaser = await create_purchaser(
                    db,
                    PurchaserCreate(name="Yard Co", tamil_name="யார்டு கோ"),
                    user_id=admin_user.id,
                )
                item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Broiler",
                        tamil_name="பிராயலர்",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[],
                        billing_item_ids=[],
                    ),
                )
                await allocate_shop_inventory_items(db, current_shop, [item.id])
                await update_inventory_item_purchase_rate(
                    db,
                    item.id,
                    InventoryItemPurchaseRateUpdate(purchase_rate=Decimal("80.00")),
                )
                await add_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryAddRequest(
                        quantity=Decimal("2.50"),
                        bird_count=5,
                        driver_name="Driver",
                        vehicle_number="TN09CC3333",
                        purchaser_id=purchaser.id,
                    ),
                )

                today = today_ist()
                report = await generate_admin_report_pdf(
                    db,
                    sections=["purchase"],
                    period="date",
                    reference_date=today,
                    shop_ids=[current_shop.id],
                    organization_id=current_shop.organization_id,
                )
                try:
                    text = _pdf_text(report)
                    self.assertIn("Yard Co", text)
                    self.assertIn("2.50", text)
                    # 2.5 * 80 = 200
                    self.assertIn("200.00", text)
                finally:
                    report.file.close()

        self.run_async(scenario())
