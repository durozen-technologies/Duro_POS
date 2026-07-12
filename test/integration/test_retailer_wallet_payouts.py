from __future__ import annotations

from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select

from test.support import AsyncSessionAdapter, BackendTestCase  # isort: skip

from app.models import Retailer
from app.schemas.retailers import RetailerCreate, RetailerWalletPayoutCreate
from app.services.retailer_wallet_payouts import record_retailer_wallet_payout
from app.services.retailers import create_retailer


class RetailerWalletPayoutIntegrationTests(BackendTestCase):
    def test_full_wallet_payout_clears_credit(self) -> None:
        admin_user = self.ensure_admin_user()

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                retailer = await create_retailer(db, RetailerCreate(name="Wallet Retailer"))
                retailer_row = session.scalar(select(Retailer).where(Retailer.id == retailer.id))
                retailer_row.credit_balance = Decimal("500.00")
                session.commit()

                result = await record_retailer_wallet_payout(
                    db,
                    admin_user,
                    retailer.id,
                    RetailerWalletPayoutCreate(
                        cash_amount=Decimal("300.00"),
                        upi_amount=Decimal("200.00"),
                    ),
                )

                session.expire_all()
                retailer_row = session.scalar(select(Retailer).where(Retailer.id == retailer.id))
                self.assertEqual(result.total_paid, Decimal("500.00"))
                self.assertEqual(result.credit_balance_before, Decimal("500.00"))
                self.assertEqual(result.credit_balance_after, Decimal("0.00"))
                self.assertEqual(retailer_row.credit_balance, Decimal("0.00"))

        self.run_async(scenario())

    def test_partial_wallet_payout_reduces_credit(self) -> None:
        admin_user = self.ensure_admin_user()

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                retailer = await create_retailer(db, RetailerCreate(name="Partial Wallet Retailer"))
                retailer_row = session.scalar(select(Retailer).where(Retailer.id == retailer.id))
                retailer_row.credit_balance = Decimal("800.00")
                session.commit()

                result = await record_retailer_wallet_payout(
                    db,
                    admin_user,
                    retailer.id,
                    RetailerWalletPayoutCreate(
                        cash_amount=Decimal("250.00"),
                        upi_amount=Decimal("0.00"),
                    ),
                )

                session.expire_all()
                retailer_row = session.scalar(select(Retailer).where(Retailer.id == retailer.id))
                self.assertEqual(result.credit_balance_after, Decimal("550.00"))
                self.assertEqual(retailer_row.credit_balance, Decimal("550.00"))

        self.run_async(scenario())

    def test_wallet_payout_rejects_over_credit(self) -> None:
        admin_user = self.ensure_admin_user()

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                retailer = await create_retailer(db, RetailerCreate(name="Overpay Retailer"))
                retailer_row = session.scalar(select(Retailer).where(Retailer.id == retailer.id))
                retailer_row.credit_balance = Decimal("100.00")
                session.commit()

                with self.assertRaises(HTTPException) as ctx:
                    await record_retailer_wallet_payout(
                        db,
                        admin_user,
                        retailer.id,
                        RetailerWalletPayoutCreate(
                            cash_amount=Decimal("150.00"),
                            upi_amount=Decimal("0.00"),
                        ),
                    )
                self.assertEqual(ctx.exception.status_code, 422)

        self.run_async(scenario())
