"""
In-memory Redis-compatible store — no Redis required.

Implements the subset of redis-py async API used by the app:
  get / set / setex / delete / expire
  rpush / ltrim / lrange
  publish / pipeline
  ping
"""
import time
from typing import Optional


class _Pipeline:
    def __init__(self, store: "_InMemoryStore"):
        self._store = store
        self._cmds: list = []

    def rpush(self, key: str, *values):
        self._cmds.append(("rpush", key, values))
        return self

    def ltrim(self, key: str, start: int, end: int):
        self._cmds.append(("ltrim", key, start, end))
        return self

    def expire(self, key: str, seconds: int):
        self._cmds.append(("expire", key, seconds))
        return self

    async def execute(self) -> list:
        results = []
        for item in self._cmds:
            cmd, *args = item
            if cmd == "rpush":
                key, values = args
                results.append(await self._store.rpush(key, *values))
            elif cmd == "ltrim":
                key, start, end = args
                results.append(await self._store.ltrim(key, start, end))
            elif cmd == "expire":
                key, seconds = args
                results.append(await self._store.expire(key, seconds))
        return results

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        pass


class _InMemoryStore:
    def __init__(self):
        self._kv: dict[str, str] = {}
        self._lists: dict[str, list[str]] = {}
        self._expiry: dict[str, float] = {}

    def _expired(self, key: str) -> bool:
        exp = self._expiry.get(key)
        if exp is None:
            return False
        if time.monotonic() > exp:
            self._kv.pop(key, None)
            self._lists.pop(key, None)
            del self._expiry[key]
            return True
        return False

    async def ping(self) -> bool:
        return True

    async def get(self, key: str) -> Optional[str]:
        if self._expired(key):
            return None
        return self._kv.get(key)

    async def set(self, key: str, value: str, ex: Optional[int] = None) -> bool:
        self._kv[key] = str(value)
        if ex is not None:
            self._expiry[key] = time.monotonic() + ex
        elif key in self._expiry:
            del self._expiry[key]
        return True

    async def setex(self, key: str, seconds: int, value: str) -> bool:
        return await self.set(key, value, ex=seconds)

    async def delete(self, *keys: str) -> int:
        count = 0
        for k in keys:
            if k in self._kv:
                del self._kv[k]
                count += 1
            if k in self._lists:
                del self._lists[k]
                count += 1
            self._expiry.pop(k, None)
        return count

    async def expire(self, key: str, seconds: int) -> int:
        if key in self._kv or key in self._lists:
            self._expiry[key] = time.monotonic() + seconds
            return 1
        return 0

    async def rpush(self, key: str, *values) -> int:
        if self._expired(key):
            pass
        if key not in self._lists:
            self._lists[key] = []
        self._lists[key].extend(str(v) for v in values)
        return len(self._lists[key])

    async def ltrim(self, key: str, start: int, end: int) -> bool:
        if key not in self._lists:
            return True
        lst = self._lists[key]
        length = len(lst)
        s = start if start >= 0 else max(0, length + start)
        e = (end + 1) if end >= 0 else (length + end + 1)
        self._lists[key] = lst[s:e]
        return True

    async def lrange(self, key: str, start: int, end: int) -> list[str]:
        if self._expired(key):
            return []
        lst = self._lists.get(key, [])
        if end == -1:
            return lst[start:]
        return lst[start:end + 1]

    async def publish(self, channel: str, message: str) -> int:
        try:
            from routers.websocket import bus
            bus._fanout(channel, str(message))
        except Exception:
            pass
        return 1

    def pipeline(self, transaction: bool = False) -> _Pipeline:
        return _Pipeline(self)


_store = _InMemoryStore()


def get_redis() -> _InMemoryStore:
    return _store


async def publish_event(channel: str, payload: str) -> None:
    await _store.publish(channel, payload)


async def check_redis_health() -> bool:
    return True


async def make_pubsub_client() -> _InMemoryStore:
    return _store
