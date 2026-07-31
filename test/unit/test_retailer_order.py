from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select

from test.support import AsyncSessionAdapter, BackendTestCase

from app.models import Shop, User
from app.schemas.retailers import RetailerCreate
from app.services.retailers import (
    create_retailer,
    list_active_retailers_for_shop,
    list_retailers,
    sync_retailer_branch_allocations,
    update_admin_retailers_order,
    update_shop_retailers_order,
)


class RetailerOrderTests(BackendTestCase):
    def test_admin_retailer_order_is_user_specific_and_persists(self) -> None:
        admin_a = self.run_async(self.harness.create_admin_user(username="admin_order_a"))
        admin_b = self.run_async(self.harness.create_admin_user(username="admin_order_b"))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)

                alpha = await create_retailer(db, RetailerCreate(name="Alpha Mart"))
                bravo = await create_retailer(db, RetailerCreate(name="Bravo Mart"))
                charlie = await create_retailer(db, RetailerCreate(name="Charlie Mart"))

                default_page = await list_retailers(db, user_id=admin_a.id, page_size=100)
                self.assertFalse(default_page.has_custom_order)
                self.assertEqual(
                    [row.name for row in default_page.items],
                    ["Alpha Mart", "Bravo Mart", "Charlie Mart"],
                )

                custom_order = [charlie.id, alpha.id, bravo.id]
                result = await update_admin_retailers_order(
                    db, admin_a.id, custom_order
                )
                self.assertEqual(result.retailer_ids, custom_order)

                page_a = await list_retailers(db, user_id=admin_a.id, page_size=100)
                self.assertTrue(page_a.has_custom_order)
                self.assertEqual([row.id for row in page_a.items], custom_order)

                page_b = await list_retailers(db, user_id=admin_b.id, page_size=100)
                self.assertFalse(page_b.has_custom_order)
                self.assertEqual(
                    [row.name for row in page_b.items],
                    ["Alpha Mart", "Bravo Mart", "Charlie Mart"],
                )

                delta = await create_retailer(db, RetailerCreate(name="Delta Mart"))
                page_after_new = await list_retailers(db, user_id=admin_a.id, page_size=100)
                self.assertEqual(
                    [row.id for row in page_after_new.items],
                    [*custom_order, delta.id],
                )

                with self.assertRaises(HTTPException) as missing_ctx:
                    await update_admin_retailers_order(
                        db, admin_a.id, [charlie.id, alpha.id]
                    )
                self.assertEqual(missing_ctx.exception.status_code, 422)

                with self.assertRaises(HTTPException) as dupe_ctx:
                    await update_admin_retailers_order(
                        db,
                        admin_a.id,
                        [charlie.id, alpha.id, bravo.id, delta.id, alpha.id],
                    )
                self.assertEqual(dupe_ctx.exception.status_code, 422)

        self.run_async(scenario())

    def test_shop_retailer_order_is_user_specific(self) -> None:
        shop_user_a, shop_a = self.run_async(
            self.harness.create_shop_user(username="shop_order_a")
        )
        shop_user_b, shop_b = self.run_async(
            self.harness.create_shop_user(username="shop_order_b")
        )

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_a = session.scalar(select(Shop).where(Shop.id == shop_a.id))
                current_b = session.scalar(select(Shop).where(Shop.id == shop_b.id))
                user_a = session.scalar(select(User).where(User.id == shop_user_a.id))
                user_b = session.scalar(select(User).where(User.id == shop_user_b.id))

                zebra = await create_retailer(db, RetailerCreate(name="Zebra Wholesale"))
                mango = await create_retailer(db, RetailerCreate(name="Mango Wholesale"))
                await sync_retailer_branch_allocations(
                    db, zebra.id, [current_a.id, current_b.id]
                )
                await sync_retailer_branch_allocations(
                    db, mango.id, [current_a.id, current_b.id]
                )

                default_list = await list_active_retailers_for_shop(
                    db, current_a, user_id=user_a.id
                )
                self.assertEqual(
                    [row.name for row in default_list],
                    ["Mango Wholesale", "Zebra Wholesale"],
                )

                custom = [zebra.id, mango.id]
                await update_shop_retailers_order(
                    db, user_a.id, current_a, custom
                )
                ordered_a = await list_active_retailers_for_shop(
                    db, current_a, user_id=user_a.id
                )
                self.assertEqual([row.id for row in ordered_a], custom)

                ordered_b = await list_active_retailers_for_shop(
                    db, current_b, user_id=user_b.id
                )
                self.assertEqual(
                    [row.name for row in ordered_b],
                    ["Mango Wholesale", "Zebra Wholesale"],
                )

                with self.assertRaises(HTTPException) as foreign_ctx:
                    await update_shop_retailers_order(
                        db,
                        user_a.id,
                        current_a,
                        [zebra.id],
                    )
                self.assertEqual(foreign_ctx.exception.status_code, 422)

        self.run_async(scenario())


if __name__ == "__main__":
    import unittest

    unittest.main()
