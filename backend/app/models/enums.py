from enum import Enum


class UserRole(str, Enum):
    SUPER_ADMIN = "super_admin"
    TENANT_ADMIN = "tenant_admin"
    SHOP_ACCOUNT = "shop_account"


def parse_user_role(raw: str | UserRole) -> UserRole:
    if isinstance(raw, UserRole):
        return raw
    if raw == "admin":
        return UserRole.TENANT_ADMIN
    return UserRole(raw)


def is_super_admin(role: UserRole) -> bool:
    return role == UserRole.SUPER_ADMIN


def is_tenant_admin(role: UserRole) -> bool:
    return role == UserRole.TENANT_ADMIN


def normalize_user_role(role: UserRole) -> UserRole:
    return role


class UnitType(str, Enum):
    WEIGHT = "weight"
    COUNT = "count"


class BaseUnit(str, Enum):
    KG = "kg"
    UNIT = "unit"


class ItemAssumptionStatus(str, Enum):
    NOT_APPLICABLE = "not_applicable"
    NOT_SET = "not_set"
    INCOMPLETE = "incomplete"
    CONFIGURED = "configured"


class BillStatus(str, Enum):
    PENDING_PAYMENT = "pending_payment"
    PAID = "paid"


class ReceiptStatus(str, Enum):
    PENDING = "pending"
    PRINTED = "printed"
    FAILED = "failed"


class InventoryMovementType(str, Enum):
    ADD = "add"
    USE = "use"


class RetailerSaleStatus(str, Enum):
    OPEN = "open"
    PARTIAL = "partial"
    SETTLED = "settled"
    VOID = "void"


class RetailerReceiptType(str, Enum):
    SALE_INVOICE = "sale_invoice"
    BALANCE_PAYMENT = "balance_payment"


class RetailerInventoryPurchaseStatus(str, Enum):
    ACTIVE = "active"
    VOID = "void"
