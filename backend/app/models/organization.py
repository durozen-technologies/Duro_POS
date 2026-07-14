from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import JSON, Boolean, DateTime, Integer, String, func, text
from sqlalchemy.ext.mutable import MutableDict
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.ids import UUID_SQL_TYPE, uuid7
from ..db.database import Base
from .base import BaseModelMixin


class Organization(Base, BaseModelMixin):
    __tablename__ = "organizations"

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    schema_name: Mapped[str | None] = mapped_column(String(63), unique=True, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    max_branches: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    settings: Mapped[dict[str, object | None]] = mapped_column(
        MutableDict.as_mutable(JSON),
        default=dict,
        server_default=text("'{}'"),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        server_default=func.now(),
        nullable=False,
    )

    # viewonly/noload: after public-schema cutover shops/users live in tenant schemas.
    # ORM delete/expire of Organization must not SELECT public.shops (table gone).
    shops = relationship(
        "Shop",
        back_populates="organization",
        viewonly=True,
        lazy="noload",
    )
    users = relationship(
        "User",
        back_populates="organization",
        viewonly=True,
        lazy="noload",
    )
