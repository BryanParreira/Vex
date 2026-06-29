from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text
import structlog

from core.config import settings

logger = structlog.get_logger()

_is_sqlite = settings.DATABASE_URL.startswith("sqlite")

if _is_sqlite:
    engine = create_async_engine(
        settings.DATABASE_URL,
        echo=settings.APP_ENV == "development",
        connect_args={"check_same_thread": False},
    )
else:
    engine = create_async_engine(
        settings.DATABASE_URL,
        echo=settings.APP_ENV == "development",
        pool_pre_ping=True,
        pool_size=20,
        max_overflow=10,
    )

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def _enable_wal() -> None:
    async with engine.begin() as conn:
        await conn.execute(text("PRAGMA journal_mode=WAL"))
        await conn.execute(text("PRAGMA foreign_keys=ON"))
        await conn.execute(text("PRAGMA busy_timeout=5000"))


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    if _is_sqlite:
        await _enable_wal()
    logger.info("Database initialized", backend="sqlite" if _is_sqlite else "postgresql")


async def check_db_health() -> bool:
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
