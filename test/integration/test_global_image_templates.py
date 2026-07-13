"""Global image template integration tests."""

from __future__ import annotations

import unittest
from io import BytesIO
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import UploadFile
from sqlalchemy import select

from test.support import AsyncSessionAdapter, BackendTestCase

from app.db.storage.images import delete_item_image_storage, save_item_image_content
from app.db.storage.paths import is_global_template_object_key
from app.models import BaseUnit, GlobalImageTemplate, Item, UnitType
from app.schemas.admin import ItemCreate, ItemUpdate
from app.services.admin._shared import _item_to_read_async
from app.services.admin.shops import create_item, update_item
from app.services.global_image_templates import resolve_effective_item_image_keys


def _square_jpeg_bytes() -> bytes:
    from PIL import Image

    image = Image.new("RGB", (100, 100), color=(200, 100, 50))
    buffer = BytesIO()
    image.save(buffer, format="JPEG")
    return buffer.getvalue()


class GlobalImageTemplateTests(BackendTestCase):
    def test_is_global_template_object_key(self) -> None:
        self.assertTrue(is_global_template_object_key("global/items/abc/original/def.jpg"))
        self.assertFalse(is_global_template_object_key("orgs/123/items/abc/original/def.jpg"))
        self.assertFalse(is_global_template_object_key(None))

    def test_delete_item_image_storage_skips_global_keys(self) -> None:
        async def scenario() -> None:
            with patch(
                "app.db.storage.images._delete_object_if_present",
                new_callable=AsyncMock,
            ) as delete_mock:
                await delete_item_image_storage(
                    "global/items/template/original/abc.jpg",
                    "orgs/org/items/item/original/def.jpg",
                )
                delete_mock.assert_awaited_once_with("orgs/org/items/item/original/def.jpg")

        self.run_async(scenario())

    def test_create_item_with_global_template_reference(self) -> None:
        async def scenario() -> None:
            org = await self.harness.create_default_organization()
            with self.harness.session_factory() as platform_session:
                platform_db = AsyncSessionAdapter(platform_session)
                template = GlobalImageTemplate(
                    name="Chicken Curry Cut",
                    image_object_key="global/items/template/original/shared.jpg",
                    image_content_type="image/jpeg",
                    image_thumbnail_object_key="global/items/template/thumb/shared.jpg",
                    image_thumbnail_content_type="image/jpeg",
                    is_active=True,
                )
                platform_session.add(template)
                platform_session.commit()
                template_id = template.id

            with self.harness.session_factory() as tenant_session:
                tenant_db = AsyncSessionAdapter(tenant_session)
                item_read = await create_item(
                    tenant_db,
                    ItemCreate(
                        name="Shop Chicken",
                        tamil_name="கோழி",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                    ),
                    organization_id=org.id,
                    global_image_template_id=template_id,
                    platform_db=platform_db,
                )

            self.assertEqual(item_read.global_image_template_id, template_id)
            self.assertIsNotNone(item_read.image_path)
            self.assertIn("/catalog/global-image-templates/", item_read.image_path)

            with self.harness.session_factory() as tenant_session:
                stored = tenant_session.scalar(select(Item).where(Item.id == item_read.id))
                assert stored is not None
                self.assertIsNone(stored.image_object_key)
                self.assertEqual(stored.global_image_template_id, template_id)

        self.run_async(scenario())

    def test_custom_upload_clears_global_template_reference(self) -> None:
        async def scenario() -> None:
            org = await self.harness.create_default_organization()
            with self.harness.session_factory() as platform_session:
                platform_db = AsyncSessionAdapter(platform_session)
                template = GlobalImageTemplate(
                    name="Mutton Curry Cut",
                    image_object_key="global/items/template/original/mutton.jpg",
                    image_content_type="image/jpeg",
                    is_active=True,
                )
                platform_session.add(template)
                platform_session.commit()
                template_id = template.id

            with self.harness.session_factory() as tenant_session:
                tenant_db = AsyncSessionAdapter(tenant_session)
                created = await create_item(
                    tenant_db,
                    ItemCreate(
                        name="Mutton",
                        tamil_name="ஆட்டு",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                    ),
                    organization_id=org.id,
                    global_image_template_id=template_id,
                    platform_db=platform_db,
                )

            with (
                unittest.mock.patch("app.db.storage.images.settings") as mock_settings,
                unittest.mock.patch(
                    "app.db.storage.images._upload_bytes",
                    new_callable=AsyncMock,
                ) as upload_mock,
            ):
                mock_settings.rustfs_enabled = True
                mock_settings.item_image_max_bytes = 10_000_000
                upload_mock.side_effect = [
                    ("orgs/custom/original/custom.jpg", "image/jpeg", '"etag"'),
                    ("orgs/custom/thumb/custom.jpg", "image/jpeg", '"etag"'),
                ]
                upload = UploadFile(
                    filename="custom.jpg",
                    file=BytesIO(_square_jpeg_bytes()),
                )
                with self.harness.session_factory() as tenant_session:
                    tenant_db = AsyncSessionAdapter(tenant_session)
                    updated = await update_item(
                        tenant_db,
                        created.id,
                        ItemUpdate(
                            name="Mutton",
                            tamil_name="ஆட்டு",
                            unit_type=UnitType.WEIGHT,
                            base_unit=BaseUnit.KG,
                            is_active=True,
                        ),
                        image=upload,
                        platform_db=platform_db,
                    )

            self.assertIsNone(updated.global_image_template_id)
            with self.harness.session_factory() as tenant_session:
                stored = tenant_session.scalar(select(Item).where(Item.id == created.id))
                assert stored is not None
                self.assertIsNone(stored.global_image_template_id)
                self.assertEqual(stored.image_object_key, "orgs/custom/original/custom.jpg")

    def test_super_admin_template_update_changes_resolved_item_image(self) -> None:
        async def scenario() -> None:
            org = await self.harness.create_default_organization()
            with self.harness.session_factory() as platform_session:
                platform_db = AsyncSessionAdapter(platform_session)
                template = GlobalImageTemplate(
                    name="Fish Fillet",
                    image_object_key="global/items/template/original/fish-v1.jpg",
                    image_content_type="image/jpeg",
                    is_active=True,
                )
                platform_session.add(template)
                platform_session.commit()
                template_id = template.id

            with self.harness.session_factory() as tenant_session:
                item = Item(
                    organization_id=org.id,
                    name="Fish",
                    tamil_name="மீன்",
                    unit_type=UnitType.WEIGHT,
                    base_unit=BaseUnit.KG,
                    global_image_template_id=template_id,
                )
                tenant_session.add(item)
                tenant_session.commit()
                item_id = item.id

            with self.harness.session_factory() as platform_session:
                stored_template = platform_session.scalar(
                    select(GlobalImageTemplate).where(GlobalImageTemplate.id == template_id)
                )
                assert stored_template is not None
                stored_template.image_object_key = "global/items/template/original/fish-v2.jpg"
                platform_session.commit()
                platform_db = AsyncSessionAdapter(platform_session)

            with self.harness.session_factory() as tenant_session:
                stored_item = tenant_session.scalar(select(Item).where(Item.id == item_id))
                assert stored_item is not None
                resolved = await resolve_effective_item_image_keys(
                    stored_item,
                    platform_db,
                )
                self.assertEqual(
                    resolved.image_object_key,
                    "global/items/template/original/fish-v2.jpg",
                )
                item_read = await _item_to_read_async(stored_item, platform_db=platform_db)
                self.assertIsNotNone(item_read.image_path)

    def test_save_item_image_content_does_not_delete_global_previous_key(self) -> None:
        async def scenario() -> None:
            org = await self.harness.create_default_organization()
            item = Item(
                id=uuid4(),
                organization_id=org.id,
                name="Egg",
                tamil_name="முட்டை",
                unit_type=UnitType.COUNT,
                base_unit=BaseUnit.UNIT,
                image_object_key="global/items/template/original/egg.jpg",
                image_content_type="image/jpeg",
            )
            mock_settings = unittest.mock.Mock()
            mock_settings.rustfs_enabled = True
            mock_settings.item_image_max_bytes = 10_000_000
            mock_settings.rustfs_bucket_name = "test"
            mock_settings.rustfs_endpoint_url = "http://localhost:9000"
            with (
                unittest.mock.patch("app.db.storage.images.settings", mock_settings),
                unittest.mock.patch(
                    "app.db.storage.images._upload_bytes",
                    new_callable=AsyncMock,
                ) as upload_mock,
                unittest.mock.patch(
                    "app.db.storage.images._delete_object_if_present",
                    new_callable=AsyncMock,
                ) as delete_mock,
            ):
                upload_mock.side_effect = [
                    ("orgs/custom/original/new.jpg", "image/jpeg", '"etag"'),
                    ("orgs/custom/thumb/new.jpg", "image/jpeg", '"etag"'),
                ]
                with self.harness.session_factory() as tenant_session:
                    tenant_db = AsyncSessionAdapter(tenant_session)
                    tenant_session.add(item)
                    tenant_session.commit()
                    await save_item_image_content(
                        tenant_db,
                        item,
                        filename="new.jpg",
                        content=_square_jpeg_bytes(),
                        content_type="image/jpeg",
                    )

                deleted_keys = [call.args[0] for call in delete_mock.await_args_list]
                self.assertNotIn("global/items/template/original/egg.jpg", deleted_keys)

        self.run_async(scenario())


if __name__ == "__main__":
    unittest.main()
