"""Hard-delete purge must not open a nested DB engine (PgBouncer deadlock)."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch
from uuid import uuid4

from app.services import tenant_data_migration as migration


class HardDeletePurgeTests(unittest.TestCase):
    def test_purge_lists_schemas_on_same_connection(self) -> None:
        org_id = uuid4()
        conn = MagicMock()
        # First execute: public.organizations schema_name query
        # Second execute: information_schema schemata query
        org_result = MagicMock()
        org_result.scalars.return_value = ["tenant_a", "tenant_skip"]
        schema_result = MagicMock()
        schema_result.scalars.return_value = ["tenant_a", "tenant_skip", "tenant_b"]
        conn.execute.side_effect = [org_result, schema_result]

        with (
            patch.object(
                migration,
                "inspect",
                return_value=MagicMock(has_table=MagicMock(return_value=True)),
            ),
            patch.object(migration, "_delete_org_scoped_tenant_rows") as delete_rows,
            patch(
                "app.db.tenant_schema.list_tenant_schema_names_from_db",
                side_effect=AssertionError("must not open nested listing"),
            ),
        ):
            migration.purge_organization_rows_for_hard_delete(
                conn, org_id, skip_schema="tenant_skip"
            )

        schemas_touched = {call.args[2] for call in delete_rows.call_args_list}
        self.assertIn("public", schemas_touched)
        self.assertIn("tenant_a", schemas_touched)
        self.assertIn("tenant_b", schemas_touched)
        self.assertNotIn("tenant_skip", schemas_touched)


if __name__ == "__main__":
    unittest.main()
