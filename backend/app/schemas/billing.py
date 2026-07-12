from datetime import datetime
from decimal import Decimal
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from ..models.enums import BaseUnit, BillStatus, ReceiptStatus, UnitType
from .common import ORMModel


class BillItemInput(BaseModel):
    item_id: UUID
    quantity: Decimal = Field(gt=0)


class CheckoutPaymentInput(BaseModel):
    cash_amount: Decimal = Field(ge=0)
    upi_amount: Decimal = Field(ge=0)
    wallet_amount: Decimal = Field(default=Decimal("0"), ge=0)


class BillCheckoutRequest(BaseModel):
    items: list[BillItemInput]
    payment: CheckoutPaymentInput

    @model_validator(mode="after")
    def validate_items(self) -> "BillCheckoutRequest":
        if not self.items:
            raise ValueError("At least one cart item is required")
        return self


class BillCheckoutCommitRequest(BillCheckoutRequest):
    checkout_token: str = Field(min_length=1)


class BillEditPaymentInput(BaseModel):
    cash_amount: Decimal = Field(ge=0)
    upi_amount: Decimal = Field(ge=0)


class BillEditRequest(BaseModel):
    items: list[BillItemInput]
    payment: BillEditPaymentInput

    @model_validator(mode="after")
    def validate_items(self) -> "BillEditRequest":
        if not self.items:
            raise ValueError("At least one bill item is required")
        return self


class BillDetailBatchRequest(BaseModel):
    bill_ids: list[UUID] = Field(min_length=1, max_length=50)


class BillLineRead(ORMModel):
    item_id: UUID
    item_name: str
    item_tamil_name: str | None = None
    item_unit_type: UnitType | None = None
    item_base_unit: BaseUnit | None = None
    quantity: Decimal
    unit: BaseUnit
    price_per_unit: Decimal
    line_total: Decimal


class PaymentRead(ORMModel):
    id: UUID
    cash_amount: Decimal
    upi_amount: Decimal
    total_paid: Decimal
    balance: Decimal
    is_settled: bool


class ReceiptRead(ORMModel):
    id: UUID
    receipt_number: str
    receipt_status: ReceiptStatus
    print_attempts: int = 0
    last_print_error: str | None = None
    printed_at: datetime | None = None


class BillRead(ORMModel):
    id: UUID
    bill_no: str
    shop_id: UUID
    shop_name: str
    organization_name: str
    total_amount: Decimal
    status: BillStatus
    created_at: datetime
    items: list[BillLineRead]
    payment: PaymentRead
    receipt: ReceiptRead
    created_by_name: str | None = None


class BillCheckoutPreviewRead(BillRead):
    checkout_token: str
    bill_no: str | None = None


class ShopBillSortField(str, Enum):
    BILL_NO = "bill_no"
    CREATED_AT = "created_at"
    TOTAL_AMOUNT = "total_amount"
    CREATED_BY = "created_by"


class ShopBillPaymentMethodFilter(str, Enum):
    CASH = "cash"
    UPI = "upi"
    MIXED = "mixed"


class ShopBillSummaryRead(BaseModel):
    bill_id: UUID
    bill_no: str
    created_at: datetime
    total_items: int
    total_quantity: Decimal
    grand_total: Decimal
    paid_amount: Decimal
    balance_amount: Decimal
    payment_method: str
    receipt_status: ReceiptStatus
    created_by_name: str | None = None


class ShopBillPage(BaseModel):
    items: list[ShopBillSummaryRead]
    page: int
    page_size: int
    total_count: int
    total_pages: int


class BillReceiptStatusUpdate(BaseModel):
    status: ReceiptStatus
    error: str | None = Field(default=None, max_length=2000)


class BillCreateResult(BaseModel):
    bill: BillRead
    created: bool
