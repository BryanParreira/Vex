"""
Cross-platform SQLAlchemy column types.
Drop-in replacements for sqlalchemy.dialects.postgresql.{UUID,JSONB,ARRAY}
that work on both SQLite and PostgreSQL.
"""
from sqlalchemy import Uuid as _Uuid, JSON


class UUID(_Uuid):
    def __init__(self, as_uuid: bool = True, **kw):
        # native_uuid=True → native UUID on PostgreSQL, VARCHAR on SQLite
        kw.setdefault("native_uuid", True)
        super().__init__(as_uuid=as_uuid, **kw)


# JSONB → cross-platform JSON (TEXT on SQLite, JSONB on PostgreSQL via type affinity)
JSONB = JSON


class ARRAY(JSON):
    """Array stored as a JSON list — SQLite compatible (no native array type)."""
    pass
