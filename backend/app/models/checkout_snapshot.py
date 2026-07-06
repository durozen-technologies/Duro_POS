from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, String, desc
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from ..core.ids import UUID_SQL_TYPE, uuid7
from ..db.database import Base
from .base import BaseModelMixin


class CheckoutSnapshot(Base, BaseModelMixin):
    __tablename__ = "checkout_snapshots"
    __table_args__ = (
        Index("ix_checkout_snapshots_shop_id_created_at_desc", "shop_id", desc("created_at")),
    )

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    checkout_token: Mapped[str] = mapped_column(String(512), unique=True, nullable=False, index=True)
    shop_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("shops.id"), index=True, nullable=False
    )
    snapshot_json: Mapped[dict] = mapped_column(JSON().with_variant(JSONB, "postgresql"), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    bill_id: Mapped[UUID | None] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("bills.id"), nullable=True, index=True
    )

    shop = relationship("Shop")
    bill = relationship("Bill")
