from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.ids import UUID_SQL_TYPE, uuid7
from ..db.database import Base
from .base import BaseModelMixin


class Permission(Base):
    __tablename__ = "permissions"

    code: Mapped[str] = mapped_column(String(80), primary_key=True)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    module: Mapped[str] = mapped_column(String(40), nullable=False)


class AdminRole(Base, BaseModelMixin):
    __tablename__ = "admin_roles"

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    organization_id: Mapped[UUID | None] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    organization = relationship("Organization")
    permissions = relationship(
        "AdminRolePermission",
        back_populates="role",
        cascade="all, delete-orphan",
    )
    user_assignments = relationship(
        "AdminUserRole",
        back_populates="role",
        cascade="all, delete-orphan",
    )


class AdminRolePermission(Base):
    __tablename__ = "admin_role_permissions"

    role_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("admin_roles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    permission_code: Mapped[str] = mapped_column(
        String(80),
        ForeignKey("permissions.code", ondelete="CASCADE"),
        primary_key=True,
    )

    role = relationship("AdminRole", back_populates="permissions")
    permission = relationship("Permission")


class AdminUserRole(Base):
    __tablename__ = "admin_user_roles"

    user_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    role_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("admin_roles.id", ondelete="CASCADE"),
        primary_key=True,
    )

    user = relationship("User", back_populates="admin_roles")
    role = relationship("AdminRole", back_populates="user_assignments")
