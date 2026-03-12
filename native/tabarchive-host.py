#!/usr/bin/env python3
"""
Tab Archive Native Messaging Host

SQLite + FTS5 backend for high-capacity tab archiving.
Communicates with browser extensions via length-prefixed JSON over stdio.
"""
from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
import struct
import sys
import time
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

MAX_MESSAGE_BYTES = 512 * 1024
MAX_RESPONSE_BYTES = 512 * 1024
MAX_QUERY_LIMIT = 1000
DEFAULT_QUERY_LIMIT = 100
MAX_EXPORT_CHUNK = 2000
DEFAULT_EXPORT_CHUNK = 200
MAX_IMPORT_BATCH = 2000
MAX_LOG_BYTES = 5 * 1024 * 1024
LOG_BACKUP_COUNT = 3
MAX_FAVICON_BYTES = 2048
APP_VERSION = "1.0.5"

DATA_DIR = Path.home() / ".tabarchive"
BIN_DIR = DATA_DIR / "bin"
DB_PATH = DATA_DIR / "tabs.db"
LOG_PATH = DATA_DIR / "host.log"

log = logging.getLogger(__name__)
log.setLevel(logging.INFO)
log.propagate = False

_LOGGING_CONFIGURED = False


def now_ms() -> int:
    return int(time.time() * 1000)


def safe_chmod(path: Path, mode: int) -> None:
    try:
        path.chmod(mode)
    except OSError:
        pass


def ensure_storage_paths() -> None:
    DATA_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    safe_chmod(DATA_DIR, 0o700)


def configure_logging() -> None:
    global _LOGGING_CONFIGURED

    if _LOGGING_CONFIGURED:
        return

    ensure_storage_paths()

    handler = RotatingFileHandler(
        str(LOG_PATH),
        maxBytes=MAX_LOG_BYTES,
        backupCount=LOG_BACKUP_COUNT,
    )
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    log.addHandler(handler)
    safe_chmod(LOG_PATH, 0o600)
    _LOGGING_CONFIGURED = True


def clamp_int(
    value: Any,
    *,
    default: int,
    minimum: int = 0,
    maximum: int | None = None,
) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default

    if parsed < minimum:
        return minimum
    if maximum is not None and parsed > maximum:
        return maximum
    return parsed


def normalize_timestamp(value: Any, *, default: int) -> int:
    return clamp_int(value, default=default, minimum=0)


def normalize_optional_timestamp(value: Any) -> int | None:
    if value is None:
        return None
    return clamp_int(value, default=0, minimum=0)


def normalize_favicon(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    if not value.startswith("data:"):
        return None
    if len(value) > MAX_FAVICON_BYTES:
        return None
    return value


def decode_metadata(raw_metadata: Any) -> Any:
    if not raw_metadata:
        return None
    try:
        return json.loads(raw_metadata)
    except (TypeError, ValueError):
        return None


def response_payload_size(message: dict[str, Any]) -> int:
    return len(json.dumps(message, separators=(",", ":")).encode("utf-8"))


def get_connection() -> sqlite3.Connection:
    """Get or create database connection with FTS5 support."""
    ensure_storage_paths()
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    init_schema(conn)
    safe_chmod(DB_PATH, 0o600)
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    """Initialize database schema with FTS5 virtual table."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS tabs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL,
            title TEXT,
            favicon_url TEXT,
            closed_at INTEGER NOT NULL,
            restored_at INTEGER,
            metadata TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_tabs_closed_at ON tabs(closed_at);
        CREATE INDEX IF NOT EXISTS idx_tabs_restored_at ON tabs(restored_at);
    """)

    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='tabs_fts'"
    )
    if cursor.fetchone() is None:
        conn.executescript("""
            CREATE VIRTUAL TABLE tabs_fts USING fts5(
                title,
                url,
                content='tabs',
                content_rowid='id'
            );

            CREATE TRIGGER tabs_ai AFTER INSERT ON tabs BEGIN
                INSERT INTO tabs_fts(rowid, title, url)
                VALUES (new.id, new.title, new.url);
            END;

            CREATE TRIGGER tabs_ad AFTER DELETE ON tabs BEGIN
                INSERT INTO tabs_fts(tabs_fts, rowid, title, url)
                VALUES ('delete', old.id, old.title, old.url);
            END;

            CREATE TRIGGER tabs_au AFTER UPDATE ON tabs BEGIN
                INSERT INTO tabs_fts(tabs_fts, rowid, title, url)
                VALUES ('delete', old.id, old.title, old.url);
                INSERT INTO tabs_fts(rowid, title, url)
                VALUES (new.id, new.title, new.url);
            END;
        """)

        conn.execute("""
            INSERT INTO tabs_fts(rowid, title, url)
            SELECT id, title, url FROM tabs
        """)

    conn.execute("""
        UPDATE tabs
        SET favicon_url = NULL
        WHERE favicon_url IS NOT NULL
        AND (
            favicon_url NOT LIKE 'data:%'
            OR length(favicon_url) > ?
        )
    """, (MAX_FAVICON_BYTES,))

    conn.commit()


def encode_message(message: dict[str, Any]) -> bytes:
    """Encode a message with a little-endian length prefix."""
    encoded = json.dumps(message, separators=(",", ":")).encode("utf-8")
    return struct.pack("<I", len(encoded)) + encoded


def read_message_from(stream) -> dict[str, Any] | None:
    """Read a length-prefixed JSON message from a stream."""
    raw_length = stream.read(4)
    if len(raw_length) == 0:
        return None
    if len(raw_length) != 4:
        raise EOFError("Failed to read message length")

    message_length = struct.unpack("<I", raw_length)[0]
    if message_length > MAX_MESSAGE_BYTES:
        raise ValueError(
            f"Message exceeds {MAX_MESSAGE_BYTES} byte limit"
        )

    raw_message = stream.read(message_length)
    if len(raw_message) != message_length:
        raise EOFError("Failed to read full message body")

    return json.loads(raw_message.decode("utf-8"))


def send_message_to(message: dict[str, Any], stream) -> None:
    """Send a length-prefixed JSON message to a stream."""
    encoded = encode_message(message)
    if len(encoded) - 4 > MAX_RESPONSE_BYTES:
        raise ValueError(
            f"Response exceeds {MAX_RESPONSE_BYTES} byte limit"
        )
    stream.write(encoded)
    stream.flush()


def read_message() -> dict[str, Any] | None:
    """Read a length-prefixed JSON message from stdin."""
    return read_message_from(sys.stdin.buffer)


def send_message(message: dict[str, Any]) -> None:
    """Send a length-prefixed JSON message to stdout."""
    send_message_to(message, sys.stdout.buffer)


def is_valid_tab_id(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def serialize_tab_row(
    row: sqlite3.Row,
    *,
    include_restored_at: bool = False,
) -> dict[str, Any]:
    tab = {
        "id": row["id"],
        "url": row["url"],
        "title": row["title"],
        "faviconUrl": normalize_favicon(row["favicon_url"]),
        "closedAt": row["closed_at"],
        "metadata": decode_metadata(row["metadata"]),
    }
    if include_restored_at:
        tab["restoredAt"] = row["restored_at"]
    return tab


def build_paginated_response(
    rows: list[sqlite3.Row],
    *,
    offset: int,
    has_more_from_query: bool,
    include_restored_at: bool = False,
) -> dict[str, Any]:
    tabs: list[dict[str, Any]] = []

    for index, row in enumerate(rows):
        tab = serialize_tab_row(row, include_restored_at=include_restored_at)
        candidate_tabs = tabs + [tab]
        candidate_has_more = has_more_from_query or index < len(rows) - 1
        candidate: dict[str, Any] = {
            "ok": True,
            "tabs": candidate_tabs,
            "count": len(candidate_tabs),
        }
        if candidate_has_more:
            candidate["hasMore"] = True
            candidate["nextOffset"] = offset + len(candidate_tabs)

        if response_payload_size(candidate) > MAX_RESPONSE_BYTES:
            if not tabs:
                return {
                    "ok": False,
                    "error": "A single archived tab exceeds the response size limit",
                }
            return {
                "ok": True,
                "tabs": tabs,
                "count": len(tabs),
                "hasMore": True,
                "nextOffset": offset + len(tabs),
            }

        tabs = candidate_tabs

    result: dict[str, Any] = {"ok": True, "tabs": tabs, "count": len(tabs)}
    if has_more_from_query:
        result["hasMore"] = True
        result["nextOffset"] = offset + len(tabs)
    return result


def handle_archive(conn: sqlite3.Connection, data: dict[str, Any]) -> dict[str, Any]:
    """Archive a single tab or batch of tabs."""
    tabs = data.get("tabs", [])
    if not tabs and "url" in data:
        tabs = [data]
    if not isinstance(tabs, list):
        tabs = []

    archived_count = 0
    for tab in tabs:
        if not isinstance(tab, dict):
            continue

        url = tab.get("url")
        if not url:
            continue

        title = tab.get("title", "")
        favicon_url = normalize_favicon(
            tab.get("faviconUrl") or tab.get("favicon_url")
        )
        closed_at = normalize_timestamp(
            tab.get("closedAt") or tab.get("closed_at"),
            default=now_ms(),
        )
        metadata = tab.get("metadata")

        conn.execute(
            """
            INSERT INTO tabs (url, title, favicon_url, closed_at, metadata)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                url,
                title,
                favicon_url,
                closed_at,
                json.dumps(metadata) if metadata is not None else None,
            ),
        )
        archived_count += 1

    conn.commit()
    return {"ok": True, "archived": archived_count}


def handle_search(conn: sqlite3.Connection, data: dict[str, Any]) -> dict[str, Any]:
    """Search archived tabs using FTS5."""
    query = str(data.get("query") or "").strip()
    limit = clamp_int(
        data.get("limit"),
        default=DEFAULT_QUERY_LIMIT,
        minimum=1,
        maximum=MAX_QUERY_LIMIT,
    )
    offset = clamp_int(data.get("offset"), default=0, minimum=0)

    if not query:
        return handle_recent(conn, {"limit": limit, "offset": offset})

    safe_query = query.replace('"', '""')
    terms = [
        re.sub(r'["\*\(\)\{\}\[\]\^~\-\+\:]', "", term)
        for term in safe_query.split()
    ]
    terms = [term for term in terms if term]

    if not terms:
        return handle_recent(conn, {"limit": limit, "offset": offset})

    fts_query = " ".join(f'"{term}"*' for term in terms)
    rows = conn.execute(
        """
        SELECT t.id, t.url, t.title, t.favicon_url, t.closed_at, t.restored_at,
               t.metadata
        FROM tabs t
        JOIN tabs_fts fts ON t.id = fts.rowid
        WHERE tabs_fts MATCH ?
        AND t.restored_at IS NULL
        ORDER BY t.closed_at DESC
        LIMIT ? OFFSET ?
        """,
        (fts_query, limit + 1, offset),
    ).fetchall()

    has_more_from_query = len(rows) > limit
    return build_paginated_response(
        rows[:limit],
        offset=offset,
        has_more_from_query=has_more_from_query,
    )


def handle_recent(conn: sqlite3.Connection, data: dict[str, Any]) -> dict[str, Any]:
    """Get recently archived tabs."""
    limit = clamp_int(
        data.get("limit"),
        default=DEFAULT_QUERY_LIMIT,
        minimum=1,
        maximum=MAX_QUERY_LIMIT,
    )
    offset = clamp_int(data.get("offset"), default=0, minimum=0)

    rows = conn.execute(
        """
        SELECT id, url, title, favicon_url, closed_at, restored_at, metadata
        FROM tabs
        WHERE restored_at IS NULL
        ORDER BY closed_at DESC
        LIMIT ? OFFSET ?
        """,
        (limit + 1, offset),
    ).fetchall()

    has_more_from_query = len(rows) > limit
    return build_paginated_response(
        rows[:limit],
        offset=offset,
        has_more_from_query=has_more_from_query,
    )


def handle_restore(conn: sqlite3.Connection, data: dict[str, Any]) -> dict[str, Any]:
    """Mark tabs as restored and return their URLs."""
    tab_ids = data.get("ids", [])
    if "id" in data:
        tab_ids = [data["id"]]

    if not isinstance(tab_ids, list) or not tab_ids:
        return {"ok": False, "error": "No tab IDs provided"}

    for tab_id in tab_ids:
        if not is_valid_tab_id(tab_id):
            return {"ok": False, "error": "Invalid tab ID"}

    placeholders = ",".join("?" * len(tab_ids))
    rows = conn.execute(
        f"SELECT id, url FROM tabs WHERE id IN ({placeholders}) AND restored_at IS NULL",
        tab_ids,
    ).fetchall()

    restored_at = now_ms()
    cursor = conn.execute(
        f"""
        UPDATE tabs
        SET restored_at = ?
        WHERE id IN ({placeholders})
        AND restored_at IS NULL
        """,
        [restored_at] + tab_ids,
    )
    conn.commit()

    result: dict[str, Any] = {"ok": True, "restored": cursor.rowcount}
    if len(rows) == 1:
        result["url"] = rows[0]["url"]
    elif rows:
        result["urls"] = [row["url"] for row in rows]
    return result


def handle_delete(conn: sqlite3.Connection, data: dict[str, Any]) -> dict[str, Any]:
    """Permanently delete archived tabs."""
    tab_ids = data.get("ids", [])
    if "id" in data:
        tab_ids = [data["id"]]

    if not isinstance(tab_ids, list) or not tab_ids:
        return {"ok": False, "error": "No tab IDs provided"}

    for tab_id in tab_ids:
        if not is_valid_tab_id(tab_id):
            return {"ok": False, "error": "Invalid tab ID"}

    placeholders = ",".join("?" * len(tab_ids))
    cursor = conn.execute(
        f"DELETE FROM tabs WHERE id IN ({placeholders})",
        tab_ids,
    )
    conn.commit()
    return {"ok": True, "deleted": cursor.rowcount}


def handle_clear(conn: sqlite3.Connection, data: dict[str, Any]) -> dict[str, Any]:
    """Clear archived tabs, optionally including restored rows."""
    include_restored = bool(data.get("includeRestored", True))

    if include_restored:
        cursor = conn.execute("DELETE FROM tabs")
    else:
        cursor = conn.execute("DELETE FROM tabs WHERE restored_at IS NULL")

    conn.commit()
    return {"ok": True, "deleted": cursor.rowcount}


def handle_stats(conn: sqlite3.Connection, data: dict[str, Any]) -> dict[str, Any]:
    """Get archive statistics."""
    row = conn.execute("""
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN restored_at IS NULL THEN 1 ELSE 0 END) as archived,
            SUM(CASE WHEN restored_at IS NOT NULL THEN 1 ELSE 0 END) as restored,
            MIN(closed_at) as oldest,
            MAX(closed_at) as newest
        FROM tabs
    """).fetchone()

    try:
        page_count = int(conn.execute("PRAGMA page_count").fetchone()[0])
        page_size = int(conn.execute("PRAGMA page_size").fetchone()[0])
        db_size = page_count * page_size
    except (TypeError, ValueError, sqlite3.DatabaseError):
        db_size = 0

    result: dict[str, Any] = {
        "ok": True,
        "totalArchived": row["archived"] or 0,
        "totalRestored": row["restored"] or 0,
        "totalAll": row["total"] or 0,
        "oldestClosedAt": row["oldest"],
        "newestClosedAt": row["newest"],
        "dbSizeBytes": db_size,
    }

    since_closed_at = data.get("sinceClosedAt")
    if since_closed_at is not None:
        try:
            since_closed_at_value = int(since_closed_at)
        except (TypeError, ValueError):
            return result

        unseen_row = conn.execute(
            """
            SELECT COUNT(*) as unseen
            FROM tabs
            WHERE restored_at IS NULL
            AND closed_at > ?
            """,
            (since_closed_at_value,),
        ).fetchone()
        result["unseenArchived"] = unseen_row["unseen"] if unseen_row else 0

    return result


def handle_export(conn: sqlite3.Connection, data: dict[str, Any]) -> dict[str, Any]:
    """Export archived tabs as JSON."""
    include_restored = bool(data.get("includeRestored", False))
    chunk_size = clamp_int(
        data.get("chunkSize"),
        default=DEFAULT_EXPORT_CHUNK,
        minimum=1,
        maximum=MAX_EXPORT_CHUNK,
    )
    offset = clamp_int(data.get("offset"), default=0, minimum=0)

    if include_restored:
        rows = conn.execute(
            """
            SELECT id, url, title, favicon_url, closed_at, restored_at, metadata
            FROM tabs
            ORDER BY closed_at DESC
            LIMIT ? OFFSET ?
            """,
            (chunk_size + 1, offset),
        ).fetchall()
    else:
        rows = conn.execute(
            """
            SELECT id, url, title, favicon_url, closed_at, restored_at, metadata
            FROM tabs
            WHERE restored_at IS NULL
            ORDER BY closed_at DESC
            LIMIT ? OFFSET ?
            """,
            (chunk_size + 1, offset),
        ).fetchall()

    has_more_from_query = len(rows) > chunk_size
    return build_paginated_response(
        rows[:chunk_size],
        offset=offset,
        has_more_from_query=has_more_from_query,
        include_restored_at=True,
    )


def handle_import(conn: sqlite3.Connection, data: dict[str, Any]) -> dict[str, Any]:
    """Import tabs from JSON."""
    tabs = data.get("tabs")
    if not isinstance(tabs, list) or not tabs:
        return {"ok": False, "error": "No tabs provided"}
    if len(tabs) > MAX_IMPORT_BATCH:
        return {
            "ok": False,
            "error": f"Import exceeds {MAX_IMPORT_BATCH} tab limit",
        }

    imported = 0
    for tab in tabs:
        if not isinstance(tab, dict):
            continue

        url = tab.get("url")
        if not url:
            continue

        conn.execute(
            """
            INSERT INTO tabs (url, title, favicon_url, closed_at, restored_at, metadata)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                url,
                tab.get("title", ""),
                normalize_favicon(tab.get("faviconUrl") or tab.get("favicon_url")),
                normalize_timestamp(
                    tab.get("closedAt") or tab.get("closed_at"),
                    default=now_ms(),
                ),
                normalize_optional_timestamp(
                    tab.get("restoredAt") or tab.get("restored_at")
                ),
                json.dumps(tab.get("metadata"))
                if tab.get("metadata") is not None
                else None,
            ),
        )
        imported += 1

    conn.commit()
    return {"ok": True, "imported": imported}


def handle_vacuum(conn: sqlite3.Connection, data: dict[str, Any]) -> dict[str, Any]:
    """Vacuum the database to reclaim space."""
    conn.execute("VACUUM")
    safe_chmod(DB_PATH, 0o600)
    return {"ok": True}


def handle_ping(conn: sqlite3.Connection, data: dict[str, Any]) -> dict[str, Any]:
    """Health check."""
    return {"ok": True, "version": APP_VERSION}


HANDLERS = {
    "archive": handle_archive,
    "search": handle_search,
    "recent": handle_recent,
    "restore": handle_restore,
    "delete": handle_delete,
    "clear": handle_clear,
    "stats": handle_stats,
    "export": handle_export,
    "import": handle_import,
    "vacuum": handle_vacuum,
    "ping": handle_ping,
}


def main() -> None:
    configure_logging()
    log.info("Native host starting (pid=%d)", os.getpid())

    try:
        conn = get_connection()
    except Exception:
        log.exception("Failed to initialize database")
        raise

    log.info("Database connection established, entering message loop")

    while True:
        try:
            message = read_message()
            if message is None:
                log.info("Received EOF, shutting down")
                break

            action = message.get("action", "")
            request_id = message.get("requestId")
            log.debug("Received action=%s requestId=%s", action, request_id)
            handler = HANDLERS.get(action)
            response = handler(conn, message) if handler else {
                "ok": False,
                "error": f"Unknown action: {action}",
            }

            if request_id is not None:
                response["requestId"] = request_id

            send_message(response)
            log.debug("Sent response for action=%s", action)
        except EOFError:
            log.info("EOFError, shutting down")
            break
        except Exception as exc:
            log.exception("Error handling message")
            error_response = {"ok": False, "error": str(exc)}
            try:
                send_message(error_response)
            except Exception:
                log.exception("Failed to send error response")
                break

    conn.close()
    log.info("Native host stopped")


if __name__ == "__main__":
    main()
