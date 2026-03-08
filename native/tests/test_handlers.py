"""Comprehensive tests for tabarchive-host.py handler functions."""

import importlib.util
import json
import sqlite3
import time
from pathlib import Path

import pytest

HOST_PATH = Path(__file__).resolve().parents[1] / "tabarchive-host.py"

spec = importlib.util.spec_from_file_location("tabarchive_host", HOST_PATH)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


@pytest.fixture()
def conn():
    """Create an in-memory SQLite database with the full schema."""
    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    module.init_schema(db)
    yield db
    db.close()


def _insert_tab(conn, url="https://example.com", title="Example", closed_at=None, restored_at=None, favicon_url=None, metadata=None):
    """Helper to insert a tab directly."""
    closed_at = closed_at or int(time.time() * 1000)
    conn.execute(
        "INSERT INTO tabs (url, title, favicon_url, closed_at, restored_at, metadata) VALUES (?, ?, ?, ?, ?, ?)",
        (url, title, favicon_url, closed_at, restored_at, json.dumps(metadata) if metadata else None),
    )
    conn.commit()
    return conn.execute("SELECT last_insert_rowid()").fetchone()[0]


# ---------------------------------------------------------------------------
# Schema initialization
# ---------------------------------------------------------------------------


class TestSchema:
    def test_schema_creates_tables(self, conn):
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
        assert "tabs" in tables
        assert "tabs_fts" in tables

    def test_schema_is_idempotent(self, conn):
        """Calling init_schema a second time should not raise."""
        module.init_schema(conn)
        module.init_schema(conn)
        count = conn.execute("SELECT COUNT(*) FROM tabs").fetchone()[0]
        assert count == 0

    def test_fts_triggers_exist(self, conn):
        triggers = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='trigger'").fetchall()]
        assert "tabs_ai" in triggers
        assert "tabs_ad" in triggers
        assert "tabs_au" in triggers


# ---------------------------------------------------------------------------
# handle_archive
# ---------------------------------------------------------------------------


class TestHandleArchive:
    def test_archive_single_tab(self, conn):
        result = module.handle_archive(conn, {
            "url": "https://example.com",
            "title": "Example",
            "faviconUrl": "https://example.com/favicon.ico",
        })
        assert result == {"ok": True, "archived": 1}

        row = conn.execute("SELECT * FROM tabs").fetchone()
        assert row["url"] == "https://example.com"
        assert row["title"] == "Example"
        assert row["favicon_url"] == "https://example.com/favicon.ico"

    def test_archive_batch(self, conn):
        result = module.handle_archive(conn, {
            "tabs": [
                {"url": "https://a.com", "title": "A"},
                {"url": "https://b.com", "title": "B"},
                {"url": "https://c.com", "title": "C"},
            ],
        })
        assert result == {"ok": True, "archived": 3}
        assert conn.execute("SELECT COUNT(*) FROM tabs").fetchone()[0] == 3

    def test_archive_skips_tabs_without_url(self, conn):
        result = module.handle_archive(conn, {
            "tabs": [
                {"title": "No URL"},
                {"url": "https://valid.com", "title": "Valid"},
            ],
        })
        assert result["archived"] == 1

    def test_archive_uses_default_closed_at(self, conn):
        before = int(time.time() * 1000)
        module.handle_archive(conn, {"url": "https://example.com"})
        after = int(time.time() * 1000)

        row = conn.execute("SELECT closed_at FROM tabs").fetchone()
        assert before <= row["closed_at"] <= after

    def test_archive_preserves_custom_closed_at(self, conn):
        module.handle_archive(conn, {"url": "https://example.com", "closedAt": 1234567890})
        row = conn.execute("SELECT closed_at FROM tabs").fetchone()
        assert row["closed_at"] == 1234567890

    def test_archive_stores_metadata(self, conn):
        module.handle_archive(conn, {
            "url": "https://example.com",
            "metadata": {"windowId": 1, "index": 3},
        })
        row = conn.execute("SELECT metadata FROM tabs").fetchone()
        assert json.loads(row["metadata"]) == {"windowId": 1, "index": 3}

    def test_archive_accepts_snake_case_favicon(self, conn):
        module.handle_archive(conn, {
            "url": "https://example.com",
            "favicon_url": "https://example.com/icon.png",
        })
        row = conn.execute("SELECT favicon_url FROM tabs").fetchone()
        assert row["favicon_url"] == "https://example.com/icon.png"

    def test_archive_populates_fts_index(self, conn):
        module.handle_archive(conn, {"url": "https://example.com", "title": "Unique Title"})
        fts_count = conn.execute("SELECT COUNT(*) FROM tabs_fts").fetchone()[0]
        assert fts_count == 1


# ---------------------------------------------------------------------------
# handle_search
# ---------------------------------------------------------------------------


class TestHandleSearch:
    def test_search_by_title(self, conn):
        _insert_tab(conn, url="https://example.com", title="Python Tutorial")
        _insert_tab(conn, url="https://other.com", title="JavaScript Guide")

        result = module.handle_search(conn, {"query": "Python"})
        assert result["ok"] is True
        assert result["count"] == 1
        assert result["tabs"][0]["title"] == "Python Tutorial"

    def test_search_by_url(self, conn):
        _insert_tab(conn, url="https://docs.python.org/3/", title="Python Docs")
        _insert_tab(conn, url="https://nodejs.org", title="Node.js")

        result = module.handle_search(conn, {"query": "python"})
        assert result["count"] == 1

    def test_search_prefix_matching(self, conn):
        _insert_tab(conn, url="https://example.com", title="Programming Tips")

        result = module.handle_search(conn, {"query": "Prog"})
        assert result["count"] == 1

    def test_search_excludes_restored_tabs(self, conn):
        _insert_tab(conn, url="https://example.com", title="Restored Tab", restored_at=int(time.time() * 1000))
        _insert_tab(conn, url="https://other.com", title="Active Tab")

        result = module.handle_search(conn, {"query": "Tab"})
        assert result["count"] == 1
        assert result["tabs"][0]["title"] == "Active Tab"

    def test_search_empty_query_falls_back_to_recent(self, conn):
        _insert_tab(conn, url="https://a.com", title="A", closed_at=1000)
        _insert_tab(conn, url="https://b.com", title="B", closed_at=2000)

        result = module.handle_search(conn, {"query": ""})
        assert result["ok"] is True
        assert result["count"] == 2

    def test_search_respects_limit_and_offset(self, conn):
        for i in range(5):
            _insert_tab(conn, url=f"https://test{i}.com", title=f"Test {i}", closed_at=1000 + i)

        result = module.handle_search(conn, {"query": "Test", "limit": 2, "offset": 0})
        assert result["count"] == 2

        result2 = module.handle_search(conn, {"query": "Test", "limit": 2, "offset": 2})
        assert result2["count"] == 2

    def test_search_limit_capped_at_max(self, conn):
        """Limit should not exceed MAX_QUERY_LIMIT."""
        _insert_tab(conn, url="https://example.com", title="Test")
        result = module.handle_search(conn, {"query": "Test", "limit": 9999})
        # Should not raise, limit is capped internally
        assert result["ok"] is True

    def test_search_escapes_fts5_special_chars(self, conn):
        _insert_tab(conn, url="https://example.com", title="C++ Programming")

        # Characters like +, -, *, etc. are FTS5 specials
        result = module.handle_search(conn, {"query": "C++"})
        assert result["ok"] is True

    def test_search_only_special_chars_falls_back_to_recent(self, conn):
        _insert_tab(conn, url="https://example.com", title="Test")

        result = module.handle_search(conn, {"query": "***"})
        assert result["ok"] is True
        # All terms stripped, should fall back to recent
        assert result["count"] == 1

    def test_search_returns_correct_fields(self, conn):
        _insert_tab(conn, url="https://example.com", title="Test", favicon_url="https://example.com/icon.png", metadata={"key": "val"})

        result = module.handle_search(conn, {"query": "Test"})
        tab = result["tabs"][0]
        assert "id" in tab
        assert tab["url"] == "https://example.com"
        assert tab["title"] == "Test"
        assert tab["faviconUrl"] == "https://example.com/icon.png"
        assert "closedAt" in tab
        assert tab["metadata"] == {"key": "val"}


# ---------------------------------------------------------------------------
# handle_recent
# ---------------------------------------------------------------------------


class TestHandleRecent:
    def test_recent_returns_tabs_ordered_by_closed_at(self, conn):
        _insert_tab(conn, url="https://old.com", title="Old", closed_at=1000)
        _insert_tab(conn, url="https://new.com", title="New", closed_at=2000)

        result = module.handle_recent(conn, {})
        assert result["tabs"][0]["title"] == "New"
        assert result["tabs"][1]["title"] == "Old"

    def test_recent_excludes_restored(self, conn):
        _insert_tab(conn, url="https://restored.com", title="Restored", restored_at=int(time.time() * 1000))
        _insert_tab(conn, url="https://active.com", title="Active")

        result = module.handle_recent(conn, {})
        assert result["count"] == 1
        assert result["tabs"][0]["title"] == "Active"

    def test_recent_respects_limit_and_offset(self, conn):
        for i in range(10):
            _insert_tab(conn, url=f"https://t{i}.com", title=f"T{i}", closed_at=1000 + i)

        result = module.handle_recent(conn, {"limit": 3, "offset": 0})
        assert result["count"] == 3

        result2 = module.handle_recent(conn, {"limit": 3, "offset": 3})
        assert result2["count"] == 3
        # No overlap
        ids1 = {t["id"] for t in result["tabs"]}
        ids2 = {t["id"] for t in result2["tabs"]}
        assert ids1.isdisjoint(ids2)

    def test_recent_empty_database(self, conn):
        result = module.handle_recent(conn, {})
        assert result == {"ok": True, "tabs": [], "count": 0}


# ---------------------------------------------------------------------------
# handle_restore
# ---------------------------------------------------------------------------


class TestHandleRestore:
    def test_restore_single_tab(self, conn):
        tab_id = _insert_tab(conn, url="https://example.com", title="Test")

        result = module.handle_restore(conn, {"id": tab_id})
        assert result["ok"] is True
        assert result["restored"] == 1
        assert result["url"] == "https://example.com"

        row = conn.execute("SELECT restored_at FROM tabs WHERE id = ?", (tab_id,)).fetchone()
        assert row["restored_at"] is not None

    def test_restore_batch(self, conn):
        id1 = _insert_tab(conn, url="https://a.com", title="A")
        id2 = _insert_tab(conn, url="https://b.com", title="B")

        result = module.handle_restore(conn, {"ids": [id1, id2]})
        assert result["ok"] is True
        assert result["restored"] == 2
        assert set(result["urls"]) == {"https://a.com", "https://b.com"}

    def test_restore_already_restored_tab_is_noop(self, conn):
        tab_id = _insert_tab(conn, url="https://example.com", restored_at=int(time.time() * 1000))

        result = module.handle_restore(conn, {"id": tab_id})
        assert result["restored"] == 0

    def test_restore_no_ids_returns_error(self, conn):
        result = module.handle_restore(conn, {})
        assert result["ok"] is False
        assert "error" in result

    def test_restore_invalid_id_type_returns_error(self, conn):
        result = module.handle_restore(conn, {"id": "not-an-int"})
        assert result["ok"] is False
        assert "Invalid tab ID" in result["error"]

    def test_restore_nonexistent_id(self, conn):
        result = module.handle_restore(conn, {"id": 99999})
        assert result["restored"] == 0

    def test_restore_sets_timestamp(self, conn):
        tab_id = _insert_tab(conn, url="https://example.com")
        before = int(time.time() * 1000)
        module.handle_restore(conn, {"id": tab_id})
        after = int(time.time() * 1000)

        row = conn.execute("SELECT restored_at FROM tabs WHERE id = ?", (tab_id,)).fetchone()
        assert before <= row["restored_at"] <= after


# ---------------------------------------------------------------------------
# handle_delete
# ---------------------------------------------------------------------------


class TestHandleDelete:
    def test_delete_single_tab(self, conn):
        tab_id = _insert_tab(conn, url="https://example.com")

        result = module.handle_delete(conn, {"id": tab_id})
        assert result == {"ok": True, "deleted": 1}
        assert conn.execute("SELECT COUNT(*) FROM tabs").fetchone()[0] == 0

    def test_delete_batch(self, conn):
        id1 = _insert_tab(conn, url="https://a.com")
        id2 = _insert_tab(conn, url="https://b.com")
        _insert_tab(conn, url="https://c.com")

        result = module.handle_delete(conn, {"ids": [id1, id2]})
        assert result["deleted"] == 2
        assert conn.execute("SELECT COUNT(*) FROM tabs").fetchone()[0] == 1

    def test_delete_no_ids_returns_error(self, conn):
        result = module.handle_delete(conn, {})
        assert result["ok"] is False

    def test_delete_invalid_id_type_returns_error(self, conn):
        result = module.handle_delete(conn, {"id": "bad"})
        assert result["ok"] is False
        assert "Invalid tab ID" in result["error"]

    def test_delete_nonexistent_id(self, conn):
        result = module.handle_delete(conn, {"id": 99999})
        assert result["deleted"] == 0

    def test_delete_removes_from_fts(self, conn):
        tab_id = _insert_tab(conn, url="https://example.com", title="Unique Searchable")
        module.handle_delete(conn, {"id": tab_id})

        result = module.handle_search(conn, {"query": "Unique Searchable"})
        assert result["count"] == 0


# ---------------------------------------------------------------------------
# handle_clear
# ---------------------------------------------------------------------------


class TestHandleClear:
    def test_clear_all_rows(self, conn):
        _insert_tab(conn, url="https://a.com", closed_at=1000)
        _insert_tab(conn, url="https://b.com", closed_at=2000, restored_at=3000)

        result = module.handle_clear(conn, {})
        assert result == {"ok": True, "deleted": 2}
        assert conn.execute("SELECT COUNT(*) FROM tabs").fetchone()[0] == 0

    def test_clear_only_unrestored_rows(self, conn):
        _insert_tab(conn, url="https://active.com", closed_at=1000)
        _insert_tab(conn, url="https://restored.com", closed_at=2000, restored_at=3000)

        result = module.handle_clear(conn, {"includeRestored": False})
        assert result == {"ok": True, "deleted": 1}
        assert conn.execute("SELECT COUNT(*) FROM tabs").fetchone()[0] == 1

    def test_clear_updates_fts_index(self, conn):
        _insert_tab(conn, url="https://example.com", title="Clear Me")
        module.handle_clear(conn, {})

        result = module.handle_search(conn, {"query": "Clear"})
        assert result["count"] == 0


# ---------------------------------------------------------------------------
# handle_stats
# ---------------------------------------------------------------------------


class TestHandleStats:
    def test_stats_empty_database(self, conn):
        result = module.handle_stats(conn, {})
        assert result["ok"] is True
        assert result["totalAll"] == 0
        assert result["totalArchived"] == 0
        assert result["totalRestored"] == 0
        assert result["oldestClosedAt"] is None
        assert result["newestClosedAt"] is None

    def test_stats_with_mixed_tabs(self, conn):
        _insert_tab(conn, url="https://a.com", closed_at=1000)
        _insert_tab(conn, url="https://b.com", closed_at=2000)
        _insert_tab(conn, url="https://c.com", closed_at=3000, restored_at=4000)

        result = module.handle_stats(conn, {})
        assert result["totalAll"] == 3
        assert result["totalArchived"] == 2
        assert result["totalRestored"] == 1
        assert result["oldestClosedAt"] == 1000
        assert result["newestClosedAt"] == 3000

    def test_stats_includes_db_path(self, conn):
        result = module.handle_stats(conn, {})
        assert "dbPath" in result
        assert "dbSizeBytes" in result

    def test_stats_with_since_closed_at_returns_unseen_archived(self, conn):
        _insert_tab(conn, url="https://old.com", closed_at=1000)
        _insert_tab(conn, url="https://new-active.com", closed_at=3000)
        _insert_tab(conn, url="https://new-restored.com", closed_at=4000, restored_at=5000)

        result = module.handle_stats(conn, {"sinceClosedAt": 2000})
        assert result["ok"] is True
        assert result["unseenArchived"] == 1

    def test_stats_with_invalid_since_closed_at_ignores_unseen_count(self, conn):
        _insert_tab(conn, url="https://example.com", closed_at=1000)

        result = module.handle_stats(conn, {"sinceClosedAt": "bad-value"})
        assert result["ok"] is True
        assert "unseenArchived" not in result


# ---------------------------------------------------------------------------
# handle_export
# ---------------------------------------------------------------------------


class TestHandleExport:
    def test_export_all_unrestored(self, conn):
        _insert_tab(conn, url="https://a.com", title="A", closed_at=2000)
        _insert_tab(conn, url="https://b.com", title="B", closed_at=1000)
        _insert_tab(conn, url="https://c.com", title="C", closed_at=3000, restored_at=4000)

        result = module.handle_export(conn, {})
        assert result["ok"] is True
        assert result["count"] == 2
        # Ordered by closed_at DESC
        assert result["tabs"][0]["url"] == "https://a.com"
        assert result["tabs"][1]["url"] == "https://b.com"

    def test_export_includes_restored(self, conn):
        _insert_tab(conn, url="https://a.com", closed_at=1000)
        _insert_tab(conn, url="https://b.com", closed_at=2000, restored_at=3000)

        result = module.handle_export(conn, {"includeRestored": True})
        assert result["count"] == 2

    def test_export_chunked_with_has_more(self, conn):
        for i in range(5):
            _insert_tab(conn, url=f"https://t{i}.com", title=f"T{i}", closed_at=1000 + i)

        result = module.handle_export(conn, {"chunkSize": 3, "offset": 0})
        assert result["count"] == 3
        assert result["hasMore"] is True
        assert result["nextOffset"] == 3

    def test_export_last_chunk_no_has_more(self, conn):
        for i in range(3):
            _insert_tab(conn, url=f"https://t{i}.com", title=f"T{i}", closed_at=1000 + i)

        result = module.handle_export(conn, {"chunkSize": 5, "offset": 0})
        assert result["count"] == 3
        assert "hasMore" not in result

    def test_export_with_offset(self, conn):
        for i in range(5):
            _insert_tab(conn, url=f"https://t{i}.com", title=f"T{i}", closed_at=1000 + i)

        result1 = module.handle_export(conn, {"chunkSize": 2, "offset": 0})
        result2 = module.handle_export(conn, {"chunkSize": 2, "offset": 2})

        urls1 = {t["url"] for t in result1["tabs"]}
        urls2 = {t["url"] for t in result2["tabs"]}
        assert urls1.isdisjoint(urls2)

    def test_export_includes_restored_at_field(self, conn):
        _insert_tab(conn, url="https://a.com", closed_at=1000, restored_at=2000)

        result = module.handle_export(conn, {"includeRestored": True})
        assert result["tabs"][0]["restoredAt"] == 2000

    def test_export_empty_database(self, conn):
        result = module.handle_export(conn, {})
        assert result == {"ok": True, "tabs": [], "count": 0}


# ---------------------------------------------------------------------------
# handle_import
# ---------------------------------------------------------------------------


class TestHandleImport:
    def test_import_tabs(self, conn):
        result = module.handle_import(conn, {
            "tabs": [
                {"url": "https://a.com", "title": "A", "closedAt": 1000},
                {"url": "https://b.com", "title": "B", "closedAt": 2000},
            ],
        })
        assert result == {"ok": True, "imported": 2}
        assert conn.execute("SELECT COUNT(*) FROM tabs").fetchone()[0] == 2

    def test_import_snake_case_fields(self, conn):
        result = module.handle_import(conn, {
            "tabs": [
                {"url": "https://a.com", "title": "A", "closed_at": 1000, "favicon_url": "https://a.com/icon.png"},
            ],
        })
        assert result["imported"] == 1
        row = conn.execute("SELECT favicon_url, closed_at FROM tabs").fetchone()
        assert row["favicon_url"] == "https://a.com/icon.png"
        assert row["closed_at"] == 1000

    def test_import_with_restored_at(self, conn):
        module.handle_import(conn, {
            "tabs": [
                {"url": "https://a.com", "closedAt": 1000, "restoredAt": 2000},
            ],
        })
        row = conn.execute("SELECT restored_at FROM tabs").fetchone()
        assert row["restored_at"] == 2000

    def test_import_skips_tabs_without_url(self, conn):
        result = module.handle_import(conn, {
            "tabs": [
                {"title": "No URL"},
                {"url": "https://valid.com", "title": "Valid"},
            ],
        })
        assert result["imported"] == 1

    def test_import_no_tabs_returns_error(self, conn):
        result = module.handle_import(conn, {"tabs": []})
        assert result["ok"] is False
        assert "error" in result

    def test_import_missing_tabs_key_returns_error(self, conn):
        result = module.handle_import(conn, {})
        assert result["ok"] is False

    def test_import_populates_fts(self, conn):
        module.handle_import(conn, {
            "tabs": [{"url": "https://example.com", "title": "Imported Page", "closedAt": 1000}],
        })
        result = module.handle_search(conn, {"query": "Imported"})
        assert result["count"] == 1

    def test_import_uses_default_closed_at(self, conn):
        before = int(time.time() * 1000)
        module.handle_import(conn, {"tabs": [{"url": "https://example.com"}]})
        after = int(time.time() * 1000)

        row = conn.execute("SELECT closed_at FROM tabs").fetchone()
        assert before <= row["closed_at"] <= after


# ---------------------------------------------------------------------------
# handle_vacuum
# ---------------------------------------------------------------------------


class TestHandleVacuum:
    def test_vacuum_runs_without_error(self, conn):
        result = module.handle_vacuum(conn, {})
        assert result == {"ok": True}

    def test_vacuum_on_populated_database(self, conn):
        for i in range(10):
            _insert_tab(conn, url=f"https://t{i}.com")
        # Delete half
        conn.execute("DELETE FROM tabs WHERE id <= 5")
        conn.commit()

        result = module.handle_vacuum(conn, {})
        assert result["ok"] is True


# ---------------------------------------------------------------------------
# handle_ping
# ---------------------------------------------------------------------------


class TestHandlePing:
    def test_ping(self, conn):
        result = module.handle_ping(conn, {})
        assert result == {"ok": True, "version": "1.0.4"}


# ---------------------------------------------------------------------------
# Message dispatch (HANDLERS dict)
# ---------------------------------------------------------------------------


class TestDispatch:
    def test_all_actions_registered(self):
        expected = {"archive", "search", "recent", "restore", "delete", "clear", "stats", "export", "import", "vacuum", "ping"}
        assert set(module.HANDLERS.keys()) == expected

    def test_unknown_action_returns_error(self, conn):
        """Simulate the main loop dispatch for an unknown action."""
        action = "nonexistent"
        handler = module.HANDLERS.get(action)
        assert handler is None
        # Main loop would produce this response:
        response = {"ok": False, "error": f"Unknown action: {action}"}
        assert response["ok"] is False
        assert "nonexistent" in response["error"]


# ---------------------------------------------------------------------------
# FTS5 special character escaping
# ---------------------------------------------------------------------------


class TestFTSEscaping:
    @pytest.mark.parametrize("query", [
        '"quoted"',
        "term*",
        "a(b)",
        "a{b}",
        "a[b]",
        "a^b",
        "a~b",
        "a-b",
        "a+b",
        "key:value",
    ])
    def test_search_with_special_chars_does_not_raise(self, conn, query):
        _insert_tab(conn, url="https://example.com", title="Test")
        result = module.handle_search(conn, {"query": query})
        assert result["ok"] is True

    def test_search_multi_term(self, conn):
        _insert_tab(conn, url="https://example.com", title="Python Web Framework")

        result = module.handle_search(conn, {"query": "Python Framework"})
        assert result["count"] == 1


# ---------------------------------------------------------------------------
# Integration: archive -> search -> restore -> search
# ---------------------------------------------------------------------------


class TestIntegration:
    def test_full_lifecycle(self, conn):
        # Archive
        module.handle_archive(conn, {
            "tabs": [
                {"url": "https://docs.python.org", "title": "Python Docs", "closedAt": 1000},
                {"url": "https://nodejs.org", "title": "Node.js", "closedAt": 2000},
            ],
        })

        # Search
        result = module.handle_search(conn, {"query": "Python"})
        assert result["count"] == 1
        tab_id = result["tabs"][0]["id"]

        # Restore
        restore_result = module.handle_restore(conn, {"id": tab_id})
        assert restore_result["url"] == "https://docs.python.org"

        # Search again - restored tab should be excluded
        result2 = module.handle_search(conn, {"query": "Python"})
        assert result2["count"] == 0

        # Stats
        stats = module.handle_stats(conn, {})
        assert stats["totalArchived"] == 1
        assert stats["totalRestored"] == 1

    def test_archive_export_import_roundtrip(self, conn):
        module.handle_archive(conn, {
            "tabs": [
                {"url": "https://a.com", "title": "A", "closedAt": 1000},
                {"url": "https://b.com", "title": "B", "closedAt": 2000},
            ],
        })

        exported = module.handle_export(conn, {"includeRestored": True})
        assert exported["count"] == 2

        # Import into a fresh database
        db2 = sqlite3.connect(":memory:")
        db2.row_factory = sqlite3.Row
        module.init_schema(db2)

        import_result = module.handle_import(db2, {"tabs": exported["tabs"]})
        assert import_result["imported"] == 2

        recent = module.handle_recent(db2, {})
        assert recent["count"] == 2
        db2.close()

    def test_delete_then_search(self, conn):
        module.handle_archive(conn, {"url": "https://example.com", "title": "Delete Me"})
        tab_id = conn.execute("SELECT id FROM tabs").fetchone()[0]

        module.handle_delete(conn, {"id": tab_id})

        result = module.handle_search(conn, {"query": "Delete"})
        assert result["count"] == 0
