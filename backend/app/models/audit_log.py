from uuid import UUID

from sqlalchemy import JSON, ForeignKey, String
from sqlalchemy.ext.mutable import MutableDict
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.ids import UUID_SQL_TYPE, uuid7
from ..db.database import Base
from .base import BaseModelMixin


class AuditLog(Base, BaseModelMixin):
    __tablename__ = "audit_logs"

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    user_id: Mapped[UUID | None] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    organization_id: Mapped[UUID | None] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("organizations.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    shop_id: Mapped[UUID | None] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("shops.id", ondelete="SET NULL"), index=True, nullable=True
    )
    action: Mapped[str] = mapped_column(String(100), index=True, nullable=False)
    entity_type: Mapped[str] = mapped_column(String(100), index=True, nullable=False)
    entity_id: Mapped[UUID | None] = mapped_column(UUID_SQL_TYPE, index=True, nullable=True)
    details: Mapped[dict[str, object | None]] = mapped_column(
        MutableDict.as_mutable(JSON),
        default=dict,
        nullable=False,
    )

    user = relationship("User")
    organization = relationship("Organization")
    shop = relationship("Shop")
