"""Runs scripts/tests/test_secrets.sh (throwaway age key, fake data) so `npm run test:sessions` covers the secrets scripts.
Skips when sops or age are not installed."""
import shutil
import subprocess
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "test_secrets.sh"


@unittest.skipUnless(shutil.which("sops") and shutil.which("age-keygen") and shutil.which("bash"), "sops and age not installed")
class SecretsScripts(unittest.TestCase):
    def test_shell_suite(self):
        result = subprocess.run(["bash", str(SCRIPT)], capture_output=True, text=True, timeout=300)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("All secrets tests passed", result.stdout)


if __name__ == "__main__":
    unittest.main()
