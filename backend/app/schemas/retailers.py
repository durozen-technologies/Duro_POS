from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from ..models.enums import BaseUnit, RetailerReceiptType, RetailerSaleStatus, UnitType
from .billing import CheckoutPaymentInput
from .common import ORMModel


class RetailerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    shop_name: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=30)
    alternate_phone: str | None = Field(default=None, max_length=30)
    address: str | None = Field(default=None, max_length=500)
    opening_balance: Decimal = Field(default=Decimal("0.00"), ge=0)
    is_active: bool = True


class RetailerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    shop_name: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=30)
    alternate_phone: str | None = Field(default=None, max_length=30)
    address: str | None = Field(default=None, max_length=500)
    opening_balance: Decimal | None = Field(default=None, ge=0)
    is_active: bool | None = None


class RetailerOutstandingBalanceUpdate(BaseModel):
    outstanding_balance: Decimal = Field(ge=0)


class RetailerRead(ORMModel):
    id: UUID
    name: str
    shop_name: str | None = None
    phone: str | None = None
    alternate_phone: str | None = None
    address: str | None = None
    is_active: bool
    credit_balance: Decimal = Decimal("0.00")
    opening_balance: Decimal = Decimal("0.00")
    allocated_shop_count: int = 0
    outstanding_balance: Decimal = Decimal("0.00")
    branch_names: list[str] = []
    can_delete: bool = True
    created_at: datetime
    updated_at: datetime


class RetailerBranchAllocationRead(BaseModel):
    shop_id: UUID
    shop_name: str
    shop_is_active: bool
    is_allocated: bool
    allocation_is_active: bool | None = None


class RetailerBranchAllocationSync(BaseModel):
    shop_ids: list[UUID] = Field(default_factory=list)


class ShopRetailerCatalogSync(BaseModel):
    item_ids: list[UUID] = Field(default_factory=list)


class RetailerPage(BaseModel):
    items: list[RetailerRead]
    total: int
    page: int
    page_size: int


class RetailerItemPriceInput(BaseModel):
    item_id: UUID
    price_per_unit: Decimal = Field(gt=0)
    is_active: bool = True


class PriceHistoryEntry(BaseModel):
    effective_date: date
    price_per_unit: Decimal


class RetailerItemPriceRead(ORMModel):
    id: UUID
    item_id: UUID
    item_name: str
    item_tamil_name: str
    price_per_unit: Decimal
    effective_date: date
    is_active: bool


class RetailerItemPriceSync(BaseModel):
    items: list[RetailerItemPriceInput]


class RetailerItemAllocationRead(BaseModel):
    item_id: UUID
    item_name: str
    item_tamil_name: str
    unit_type: UnitType
    base_unit: BaseUnit
    image_path: str | None = None
    image_thumb_path: str | None = None
    billing_price: Decimal | None = None
    is_allocated: bool
    retailer_item_price_id: UUID | None = None
    price_per_unit: Decimal | None = None
    allocation_is_active: bool | None = None
    price_history: list[PriceHistoryEntry] = Field(default_factory=list)


class RetailerItemAllocationListRead(BaseModel):
    items: list[RetailerItemAllocationRead]
    total: int
    allocated_count: int


class RetailerItemAllocationBulkCreate(BaseModel):
    items: list[RetailerItemPriceInput]


class RetailerItemAllocationBulkRead(BaseModel):
    items: list[RetailerItemPriceRead]
    allocated_count: int
    already_allocated_count: int


class RetailerItemAllocationUpdate(BaseModel):
    price_per_unit: Decimal | None = Field(default=None, gt=0)
    is_active: bool | None = None


class RetailerCatalogItemRead(ORMModel):
    item_id: UUID
    item_name: str
    item_tamil_name: str
    item_unit_type: UnitType
    item_base_unit: BaseUnit
    price_per_unit: Decimal
    image_path: str | None = None
    image_thumb_path: str | None = None


class RetailerOpenSaleSummary(ORMModel):
    id: UUID
    sale_no: str
    shop_id: UUID
    shop_name: str
    total_amount: Decimal
    amount_paid_total: Decimal
    balance_due: Decimal
    status: RetailerSaleStatus
    created_at: datetime


class RetailerBalanceRead(BaseModel):
    retailer_id: UUID
    retailer_name: str
    outstanding_balance: Decimal
    opening_balance: Decimal = Decimal("0.00")
    credit_balance: Decimal = Decimal("0.00")
    open_sales: list[RetailerOpenSaleSummary]


class RetailerWalletRead(BaseModel):
    retailer_id: UUID
    retailer_name: str
    credit_balance: Decimal
    opening_balance: Decimal = Decimal("0.00")
    outstanding_balance: Decimal = Decimal("0.00")


class RetailerSaleItemInput(BaseModel):
    item_id: UUID
    quantity: Decimal = Field(gt=0)


class RetailerSaleCheckoutRequest(BaseModel):
    retailer_id: UUID
    items: list[RetailerSaleItemInput]
    payment: CheckoutPaymentInput
    include_opening_balance: bool = True

    @model_validator(mode="after")
    def validate_items(self) -> "RetailerSaleCheckoutRequest":
        if not self.items:
            raise ValueError("At least one cart item is required")
        return self


class RetailerSaleCheckoutCommitRequest(RetailerSaleCheckoutRequest):
    checkout_token: str = Field(min_length=1)


class RetailerSaleLineRead(ORMModel):
    item_id: UUID
    item_name: str
    item_tamil_name: str | None = None
    item_unit_type: UnitType | None = None
    item_base_unit: BaseUnit | None = None
    quantity: Decimal
    unit: BaseUnit
    price_per_unit: Decimal
    line_total: Decimal


class RetailerPaymentRead(ORMModel):
    id: UUID
    cash_amount: Decimal
    upi_amount: Decimal
    wallet_amount: Decimal = Decimal("0.00")
    total_paid: Decimal
    paid_at: datetime
    recorded_by_user_id: UUID


class RetailerSaleReceiptRead(ORMModel):
    id: UUID
    receipt_number: str
    receipt_type: RetailerReceiptType
    retailer_payment_id: UUID
    printed_at: datetime
    payment_total: Decimal | None = None
    opening_balance: Decimal = Decimal("0.00")


class RetailerSaleRead(ORMModel):
    id: UUID
    sale_no: str
    retailer_id: UUID
    retailer_name: str
    shop_id: UUID
    shop_name: str
    organization_name: str
    total_amount: Decimal
    amount_paid_total: Decimal
    balance_due: Decimal
    status: RetailerSaleStatus
    created_at: datetime
    created_by_user_id: UUID
    items: list[RetailerSaleLineRead]
    payments: list[RetailerPaymentRead]
    receipts: list[RetailerSaleReceiptRead] = []
    receipt: RetailerSaleReceiptRead | None = None


class RetailerSaleReceiptPage(BaseModel):
    items: list[RetailerSaleReceiptRead]
    total: int
    page: int
    page_size: int


class RetailerPaymentRecordResponse(BaseModel):
    sale: RetailerSaleRead
    payment_receipt: RetailerSaleReceiptRead


class RetailerSalePreviewRead(RetailerSaleRead):
    checkout_token: str


class RetailerSalePage(BaseModel):
    items: list[RetailerSaleRead]
    total: int
    page: int
    page_size: int


class RetailerPaymentCreate(BaseModel):
    payment: CheckoutPaymentInput


class RetailerSaleAdminPaymentInput(BaseModel):
    cash_amount: Decimal = Field(ge=0)
    upi_amount: Decimal = Field(ge=0)
    wallet_amount: Decimal = Field(default=Decimal("0"), ge=0)


class RetailerSaleEditRequest(BaseModel):
    items: list[RetailerSaleItemInput]
    payment: RetailerSaleAdminPaymentInput

    @model_validator(mode="after")
    def validate_items(self) -> "RetailerSaleEditRequest":
        if not self.items:
            raise ValueError("At least one bill item is required")
        return self


class RetailerWalletPayoutCreate(BaseModel):
    cash_amount: Decimal = Field(default=Decimal("0"), ge=0)
    upi_amount: Decimal = Field(default=Decimal("0"), ge=0)
    notes: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def validate_amounts(self) -> "RetailerWalletPayoutCreate":
        if self.cash_amount + self.upi_amount <= 0:
            raise ValueError("At least one of cash or UPI amount is required")
        return self


class RetailerWalletPayoutRead(ORMModel):
    id: UUID
    retailer_id: UUID
    cash_amount: Decimal
    upi_amount: Decimal
    total_paid: Decimal
    credit_balance_before: Decimal
    credit_balance_after: Decimal
    notes: str | None = None
    recorded_by_user_id: UUID
    created_at: datetime
