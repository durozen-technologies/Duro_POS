from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from ..models.enums import BaseUnit, BillStatus, UnitType
from .common import ORMModel


class BillItemInput(BaseModel):
    item_id: UUID
    quantity: Decimal = Field(gt=0)


class CheckoutPaymentInput(BaseModel):
    cash_amount: Decimal = Field(ge=0)
    upi_amount: Decimal = Field(ge=0)


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
    printed_at: datetime


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


class BillCheckoutPreviewRead(BillRead):
    checkout_token: str
