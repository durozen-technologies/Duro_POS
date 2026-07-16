from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    column,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.ids import UUID_SQL_TYPE, uuid7
from ..db.database import Base
from .base import BaseModelMixin
from .enums import UserRole


class User(Base, BaseModelMixin):
    __tablename__ = "users"
    __table_args__ = (
        Index(
            "ix_users_org_role_active",
            "organization_id",
            "role",
            "is_active",
        ),
        Index(
            "uq_users_org_username",
            func.lower(column("username")),
            "organization_id",
            unique=True,
            postgresql_where=text("organization_id IS NOT NULL"),
            sqlite_where=text("organization_id IS NOT NULL"),
        ),
        Index(
            "uq_users_platform_username",
            func.lower(column("username")),
            unique=True,
            postgresql_where=text("organization_id IS NULL"),
            sqlite_where=text("organization_id IS NULL"),
        ),
    )

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    username: Mapped[str] = mapped_column(String(50), index=True, nullable=False)
    shop_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), nullable=False)
    organization_id: Mapped[UUID | None] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("organizations.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    permissions_version: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    organization = relationship("Organization", back_populates="users")
    shop = relationship("Shop", back_populates="owner", uselist=False)
    admin_roles = relationship("AdminUserRole", back_populates="user", cascade="all, delete-orphan")
