import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from assistants.language_mentor.exam_catalog import select_authentic
from test_exam_practice import GRAMMAR


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "paper.json").write_text(json.dumps(GRAMMAR), encoding="utf-8")
        self.item = {
            "id": "licensed-example", "level": "cet", "topic": "grammar",
            "source_name": "经许可的测试来源", "source_url": "https://example.com/paper",
            "year": "2024", "region": "全国", "license_id": "LIC-2024-1",
            "permission_evidence": "https://example.com/permission",
            "permission_expires": "2999-12-31", "allow_online_display": True,
            "allow_interactive_quiz": True, "content_file": "paper.json",
        }

    def _write(self, items):
        (self.root / "manifest.json").write_text(json.dumps({"items": items}), encoding="utf-8")

    def test_empty_manifest_returns_no_originals(self):
        self._write([])
        self.assertIsNone(select_authentic("cet", "grammar", self.root))
        self.assertIsNone(select_authentic("ielts", "grammar", self.root))

    def test_only_explicitly_licensed_current_originals_are_served(self):
        self._write([self.item])
        selected = select_authentic("cet", "grammar", self.root)
        self.assertEqual(selected["paper"]["questions"][0]["answer"], "B")
        self.assertEqual(selected["origin"]["name"], "经许可的测试来源")
        self.assertNotIn("license_id", selected["origin"])
        self.assertIsNone(select_authentic("cet", "reading", self.root))
        self.assertIsNone(select_authentic("ielts", "grammar", self.root))

    def test_multiple_licensed_originals_can_be_reached(self):
        second = {**self.item, "id": "licensed-second", "source_name": "第二份许可真题",
                  "content_file": "paper2.json"}
        (self.root / "paper2.json").write_text(json.dumps(GRAMMAR), encoding="utf-8")
        self._write([self.item, second])
        with patch("assistants.language_mentor.exam_catalog.secrets.choice", side_effect=lambda items: items[-1]):
            selected = select_authentic("cet", "grammar", self.root)
        self.assertEqual(selected["origin"]["name"], "第二份许可真题")

    def test_expired_or_incomplete_permission_cannot_be_served(self):
        for replacement in (
            {"permission_expires": "2000-01-01"}, {"allow_online_display": False},
            {"allow_interactive_quiz": False}, {"permission_evidence": ""},
            {"license_id": ""}, {"source_url": ""},
        ):
            with self.subTest(replacement=replacement):
                self._write([{**self.item, **replacement}])
                self.assertIsNone(select_authentic("cet", "grammar", self.root))

    def test_catalog_cannot_read_files_outside_content_directory(self):
        self._write([{**self.item, "content_file": "../private.json"}])
        with self.assertRaises(ValueError):
            select_authentic("cet", "grammar", self.root)

    def test_missing_or_malformed_paper_fails_closed(self):
        self._write([{**self.item, "content_file": "missing.json"}])
        with self.assertRaises(ValueError):
            select_authentic("cet", "grammar", self.root)
        self._write([self.item])
        (self.root / "paper.json").write_text("{}", encoding="utf-8")
        with self.assertRaises(ValueError):
            select_authentic("cet", "grammar", self.root)


if __name__ == "__main__":
    unittest.main()
