from uuid import UUID

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from ..core.ids import UUID_SQL_TYPE, uuid7
from ..db.database import Base


class UserAuthIndex(Base):
    """Platform login resolver: username + org → tenant schema and user id."""

    __tablename__ = "user_auth_index"
    __table_args__ = (
        Index(
            "uq_user_auth_index_username_org",
            "username_lower",
            "organization_id",
            unique=True,
        ),
    )

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, default=uuid7)
    username_lower: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    organization_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    schema_name: Mapped[str] = mapped_column(String(63), nullable=False)
    user_id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, nullable=False, index=True)
