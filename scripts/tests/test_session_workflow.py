"""Exercise session creation and PR/push policy through the public CLI and real Git."""
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'session-log.py'


class SessionWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='dip-session-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'scripts').mkdir()
        shutil.copyfile(SCRIPT, self.root / 'scripts/session-log.py')
        self.git('init')
        self.git('config', 'user.name', 'Session Test')
        self.git('config', 'user.email', 'session@example.invalid')
        (self.root / 'README.md').write_text('Local test baseline\n')
        self.commit('baseline')
        self.base = self.git('rev-parse', 'HEAD')

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.root, text=True, stderr=subprocess.DEVNULL).strip()

    def commit(self, message):
        self.git('add', '.')
        self.git('commit', '-m', message)

    def cli(self, *args):
        return subprocess.run(['python3', 'scripts/session-log.py', *args], cwd=self.root, text=True, capture_output=True)

    def log(self, user='tester'):
        folder = self.root / 'docs/sessions'
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / 'SESSION_tester_2026-10-28_001.md'
        text = f'User: {user}\nDate: 2026-10-28\nWorkstream: test\nAgent: Codex\nStatus: handoff\n'
        text += ''.join(f'\n## {section}\nVerified session handoff evidence.\n' for section in ('Summary', 'Changes', 'Validation', 'Decisions', 'Handoff'))
        path.write_text(text)
        return path

    def test_missing_log_cannot_pass(self):
        result = self.cli('check', '--base', self.base)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('PR must add', result.stderr)

    def test_exact_identity_and_distinct_pr_push_policy(self):
        path = self.log(user='tester-suffix')
        self.commit('incorrect owner')
        self.assertNotEqual(self.cli('check', '--base', self.base).returncode, 0)
        self.log()
        self.commit('valid owner')
        self.assertEqual(self.cli('check', '--base', self.base).returncode, 0)
        before = self.git('rev-parse', 'HEAD')
        path.write_text(path.read_text() + '\nAdditional checks from this same session.\n')
        self.commit('same session continuation')
        self.assertEqual(self.cli('check', '--base', before, '--allow-updated').returncode, 0)
        self.assertNotEqual(self.cli('check', '--base', before).returncode, 0)
        self.assertEqual(self.cli('check', '--base', self.base).returncode, 0)

    def test_creator_avoids_collisions_and_active_log_is_not_finished(self):
        for number in (1, 2):
            result = self.cli('new', '--user', 'tester', '--date', '2026-10-28', '--workstream', 'test')
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn(f'_{number:03}.md', result.stdout)
        self.commit('active sessions')
        self.assertNotEqual(self.cli('check', '--base', self.base).returncode, 0)
        self.assertNotEqual(self.cli('new', '--user', '../invalid', '--workstream', 'test').returncode, 0)


if __name__ == '__main__':
    unittest.main()
