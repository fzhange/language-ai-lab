import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from http_api import app


class NotesHttpTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name) / 'notes'
        self.root.mkdir()
        (self.root / 'grammar.md').write_text('# Grammar\n\nUnderstand the meaning.')
        (self.root / 'AGENTS.md').write_text('# Agent instructions')
        (self.root / '.hidden').mkdir()
        (self.root / '.hidden/private.md').write_text('# Hidden')
        self.outside = Path(temporary.name) / 'outside.md'
        self.outside.write_text('# Outside')
        (self.root / 'linked.md').symlink_to(self.outside)
        env = patch.dict(os.environ, {'NOL_ROOT': str(self.root)})
        env.start()
        self.addCleanup(env.stop)
        self.client = TestClient(app)

    def test_lists_and_reads_notes_without_agent_dependencies(self):
        response = self.client.get('/notes')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [{'path': 'grammar.md', 'title': 'Grammar'}])
        response = self.client.get('/notes/grammar.md')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.text, '# Grammar\n\nUnderstand the meaning.')

    def test_rejects_hidden_non_markdown_and_external_paths(self):
        for path in ('linked.md', '.hidden/private.md', 'grammar.txt', '..%2Foutside.md'):
            with self.subTest(path=path):
                self.assertEqual(self.client.get('/notes/' + path).status_code, 404)

    def test_missing_library_returns_service_unavailable(self):
        with patch.dict(os.environ, {'NOL_ROOT': str(self.root / 'missing')}):
            self.assertEqual(self.client.get('/notes').status_code, 503)


if __name__ == '__main__':
    unittest.main()
