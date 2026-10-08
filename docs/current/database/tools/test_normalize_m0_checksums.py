import tempfile
import unittest
from pathlib import Path
from hashlib import sha256
from normalize_m0_checksums import normalize_manifest

class ManifestTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)
        self.payload=b'SELECT 1;\r\n'
        (self.root/'001.sql').write_bytes(self.payload)
        self.line=sha256(self.payload).hexdigest().encode()+b'  001.sql'
    def tearDown(self):self.tmp.cleanup()
    def manifest(self,data):
        path=self.root/'SHA256SUMS';path.write_bytes(data);return path
    def test_crlf_only_normalized_payload_and_hash_preserved(self):
        p=self.manifest(self.line+b'\r\n')
        result=normalize_manifest(self.root)
        self.assertEqual(p.read_bytes(),self.line+b'\n')
        self.assertEqual((self.root/'001.sql').read_bytes(),self.payload)
        self.assertEqual(result['files_verified'],1)
        self.assertTrue(result['changed'])
    def test_lf_rerun_is_noop(self):
        p=self.manifest(self.line+b'\n')
        self.assertFalse(normalize_manifest(self.root)['changed'])
        self.assertEqual(p.read_bytes(),self.line+b'\n')
    def test_changed_payload_does_not_regenerate_expected_hash(self):
        p=self.manifest(self.line+b'\r\n');(self.root/'001.sql').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'NOT regenerated'):normalize_manifest(self.root)
        self.assertEqual(p.read_bytes(),self.line+b'\r\n')
    def test_missing_payload_stops(self):
        self.manifest(sha256(b'none').hexdigest().encode()+b'  absent.sql\r\n')
        with self.assertRaisesRegex(ValueError,'Payload missing'):normalize_manifest(self.root)
    def test_path_escape_stops(self):
        self.manifest(sha256(b'none').hexdigest().encode()+b'  ../outside.sql\r\n')
        with self.assertRaisesRegex(ValueError,'Unsafe'):normalize_manifest(self.root)
    def test_duplicates_stops(self):
        self.manifest((self.line+b'\r\n')*2)
        with self.assertRaisesRegex(ValueError,'duplicate'):normalize_manifest(self.root)
    def test_lone_cr_and_bom_stop(self):
        for raw in [self.line+b'\r',b'\xef\xbb\xbf'+self.line+b'\r\n']:
            self.manifest(raw)
            with self.assertRaisesRegex(ValueError,'Unexpected'):normalize_manifest(self.root)

if __name__=='__main__':unittest.main(verbosity=2)
