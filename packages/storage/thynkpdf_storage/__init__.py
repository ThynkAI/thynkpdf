"""Object storage interface. LocalStorage for dev/tests; S3Storage (boto3/MinIO) for prod."""
from __future__ import annotations
import os, re, hashlib
from pathlib import Path
from typing import Protocol

_KEY = re.compile(r"^[A-Za-z0-9_-]+(/[A-Za-z0-9_.-]+)*$")


class StorageError(Exception): pass


def validate_key(key: str) -> str:
    if not _KEY.match(key) or ".." in key.split("/") or key.startswith("/"):
        raise StorageError("invalid storage key")
    return key


def tenant_key(org_id: str, doc_id: str, version_id: str) -> str:
    return validate_key(f"orgs/{org_id}/docs/{doc_id}/{version_id}.pdf")


class ObjectStorage(Protocol):
    def put(self, key: str, data: bytes) -> str: ...
    def get(self, key: str) -> bytes: ...
    def path(self, key: str) -> Path | None: ...
    def exists(self, key: str) -> bool: ...


class LocalStorage:
    def __init__(self, root: str):
        self.root = Path(root).resolve(); self.root.mkdir(parents=True, exist_ok=True)

    def _p(self, key: str) -> Path:
        p = (self.root / validate_key(key)).resolve()
        if self.root not in p.parents: raise StorageError("path escapes storage root")
        return p

    def put(self, key, data):
        p = self._p(key)
        if p.exists(): raise StorageError("object exists (immutable)")
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp"); tmp.write_bytes(data); os.replace(tmp, p)
        return hashlib.sha256(data).hexdigest()

    def get(self, key): return self._p(key).read_bytes()
    def path(self, key): return self._p(key)
    def exists(self, key): return self._p(key).exists()


class S3Storage:  # pragma: no cover - requires MinIO/S3 (not available on this box)
    def __init__(self, bucket, **kw):
        import boto3; self.s3, self.bucket = boto3.client("s3", **kw), bucket
    def put(self, key, data):
        self.s3.put_object(Bucket=self.bucket, Key=validate_key(key), Body=data, IfNoneMatch="*", ServerSideEncryption="AES256")
        return hashlib.sha256(data).hexdigest()
    def get(self, key): return self.s3.get_object(Bucket=self.bucket, Key=validate_key(key))["Body"].read()
    def path(self, key): return None
    def exists(self, key):
        try: self.s3.head_object(Bucket=self.bucket, Key=validate_key(key)); return True
        except Exception: return False
