from pydantic import BaseModel, Field


class InventoryBackdatePolicyRead(BaseModel):
    allow_shop_backdated_inventory: bool
    shop_backdate_window_days: int | None = None


class InventoryBackdatePolicyUpdate(BaseModel):
    allow_shop_backdated_inventory: bool
    shop_backdate_window_days: int | None = Field(default=0, ge=0, le=365)
