from pathlib import Path
import hashlib
import subprocess
import unittest

HERE = Path(__file__).resolve().parent
BASH = 'D:/Program Files/Git/bin/bash.exe'
SOURCE = (HERE / 'run-uc-copy-preflight-20261005-r2.sh').read_text(encoding='utf-8')
GUARD = SOURCE.split('# END_METADATA_VALIDATOR', 1)[0]
COMMAND = GUARD + chr(10) + 'validate_backend_metadata "$@"'
TAG = 'ts-agent-backend:20261003-workflows-r2'
IMAGE = 'sha256:4ca6143e223802bc957256f55e78c3f648f3d010208fba2f2171f77df4abb989'

class Tests(unittest.TestCase):
    def check(self, fields, ok, message):
        result = subprocess.run([BASH,'-c',COMMAND,'fixture',*fields],capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode == 0,ok,result.stdout+result.stderr)
        self.assertIn(message,result.stdout)
    def test_named_tag_and_matching_actual_image(self):
        self.check([TAG,IMAGE,'true','host'],True,'BACKEND_IDENTITY_OK')
    def test_pinned_image_id_and_matching_actual_image(self):
        self.check([IMAGE,IMAGE,'true','host'],True,'BACKEND_IDENTITY_OK')
    def test_correct_tag_wrong_actual_image_rejected(self):
        self.check([TAG,'sha256:'+'0'*64,'true','host'],False,'actual image ID differs')
    def test_pinned_reference_wrong_actual_image_rejected(self):
        self.check([IMAGE,'sha256:'+'0'*64,'true','host'],False,'actual image ID differs')
    def test_unexpected_tag_rejected_even_if_actual_image_matches(self):
        self.check(['other:tag',IMAGE,'true','host'],False,'unexpected image reference')
    def test_short_image_reference_not_broadly_normalized(self):
        self.check(['4ca6143e2238',IMAGE,'true','host'],False,'unexpected image reference')
    def test_stopped_container_rejected(self):
        self.check([IMAGE,IMAGE,'false','host'],False,'not running')
    def test_invalid_running_literal_rejected(self):
        self.check([IMAGE,IMAGE,'True','host'],False,'not running')
    def test_bridge_network_rejected(self):
        self.check([IMAGE,IMAGE,'true','bridge'],False,'unexpected network mode')
    def test_empty_reference_rejected(self):
        self.check(['',IMAGE,'true','host'],False,'unexpected image reference')
    def test_missing_field_rejected(self):
        self.check([TAG,IMAGE,'true'],False,'invalid metadata field count')
    def test_extra_field_rejected(self):
        self.check([TAG,IMAGE,'true','host','extra'],False,'invalid metadata field count')
    def test_delivered_r1_files_unchanged(self):
        pairs = [('inspect_uc_copy_20261005_r1.py','b4a850c1794750d99e63c6150dd2f52c1d4013fb6ed6854559884caee2d9b06d'),('run-uc-copy-preflight-20261005-r1.sh','129a0f635c0f151c96e73fb618c2060442549227f7f6814ec6defbdb1532abb7')]
        for name,expected in pairs:
            self.assertEqual(hashlib.sha256((HERE/name).read_bytes()).hexdigest(),expected)

if __name__ == '__main__':
    unittest.main(verbosity=2)
