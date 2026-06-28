from pydantic import BaseModel, ConfigDict


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class APIErrorDetail(BaseModel):
    code: str
    message: str
    details: dict | list | None = None


class APIErrorResponse(BaseModel):
    error: APIErrorDetail
