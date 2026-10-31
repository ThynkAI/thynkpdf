"""Cryptographic PDF signatures via pyHanko (MIT). Private keys stay server-side; never serialized to clients.
Dev certificates are self-signed, labelled UNTRUSTED, and always reported as trusted=false."""
import datetime as dt, io
from pathlib import Path
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

DEV_CN = "THYNKPDF DEV TEST CERTIFICATE - UNTRUSTED - NOT AN IDENTITY"


class SignatureError(Exception):
    def __init__(self, code, message, details=None):
        super().__init__(message); self.code, self.message, self.details = code, message, details or {}


def generate_dev_cert(directory: str) -> tuple[str, str]:
    d = Path(directory); d.mkdir(parents=True, exist_ok=True)
    key_p, cert_p = d / "dev-signing-key.pem", d / "dev-signing-cert.pem"
    if key_p.exists() and cert_p.exists(): return str(cert_p), str(key_p)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, DEV_CN), x509.NameAttribute(NameOID.ORGANIZATION_NAME, "THYNKPDF development (untrusted)")])
    now = dt.datetime.now(dt.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now - dt.timedelta(minutes=5)).not_valid_after(now + dt.timedelta(days=365))
            .add_extension(x509.KeyUsage(digital_signature=True, content_commitment=True, key_encipherment=False, data_encipherment=False,
                                         key_agreement=False, key_cert_sign=False, crl_sign=False, encipher_only=False, decipher_only=False), critical=True)
            .sign(key, hashes.SHA256()))
    key_p.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    key_p.chmod(0o600)
    cert_p.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return str(cert_p), str(key_p)


class Signer:
    def __init__(self, cert_path: str, key_path: str, passphrase: str = "", trusted: bool = False):
        from pyhanko.sign import signers
        self._signer = signers.SimpleSigner.load(key_path, cert_path, key_passphrase=passphrase.encode() or None)
        if self._signer is None: raise SignatureError("SIGNING_NOT_CONFIGURED", "Could not load signing certificate/key")
        self.cert_pem = Path(cert_path).read_bytes()
        self.trusted = trusted
        subj = self._signer.signing_cert.subject.human_friendly
        self.untrusted_dev = DEV_CN in subj
        if self.untrusted_dev: self.trusted = False

    def info(self) -> dict:
        c = self._signer.signing_cert
        return {"subject": c.subject.human_friendly, "issuer": c.issuer.human_friendly, "serial": str(c.serial_number),
                "not_after": c["tbs_certificate"]["validity"]["not_after"].native.isoformat(),
                "trusted_identity": self.trusted, "dev_untrusted": self.untrusted_dev,
                "sha256_fingerprint": c.sha256.hex()}

    def sign(self, data: bytes, field_name: str = "ThynkSig1", reason: str | None = None, location: str | None = None,
             page: int | None = None, box: list[float] | None = None) -> bytes:
        from pyhanko.sign import signers, fields
        from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
        try:
            w = IncrementalPdfFileWriter(io.BytesIO(data), strict=False)
        except Exception:
            raise SignatureError("PDF_MALFORMED", "PDF could not be opened for signing")
        spec = None
        if page is not None and box is not None:
            spec = fields.SigFieldSpec(field_name, on_page=page - 1, box=tuple(box))
        meta = signers.PdfSignatureMetadata(field_name=field_name, reason=reason, location=location, md_algorithm="sha256")
        try:
            out = signers.sign_pdf(w, meta, signer=self._signer, new_field_spec=spec)
        except Exception as e:
            raise SignatureError("SIGNING_FAILED", "Signing failed", {"reason": type(e).__name__})
        return out.getvalue()


def verify(data: bytes, trust_roots_pem: list[bytes] = ()) -> list[dict]:
    import logging; logging.getLogger("pyhanko").setLevel(logging.CRITICAL)  # avoid cert dumps in logs
    from pyhanko.pdf_utils.reader import PdfFileReader
    from pyhanko.sign.validation import validate_pdf_signature
    from pyhanko_certvalidator import ValidationContext
    from pyhanko.keys import load_cert_from_pemder
    from asn1crypto import pem, x509 as ax
    roots = []
    for b in trust_roots_pem:
        _, _, der = pem.unarmor(b); roots.append(ax.Certificate.load(der))
    try: r = PdfFileReader(io.BytesIO(data), strict=False)
    except Exception: raise SignatureError("PDF_MALFORMED", "PDF could not be parsed")
    out = []
    for sig in r.embedded_signatures:
        vc = ValidationContext(trust_roots=roots, allow_fetching=False)
        try:
            st = validate_pdf_signature(sig, vc)
            cert = st.signing_cert
            out.append({"field": sig.field_name, "intact": bool(st.intact), "crypto_valid": bool(st.valid),
                        "trusted": bool(st.trusted), "coverage": st.coverage.name if st.coverage else None,
                        "modification_level": st.modification_level.name if st.modification_level else None,
                        "docmdp_ok": st.docmdp_ok, "signing_time": st.signer_reported_dt.isoformat() if st.signer_reported_dt else None,
                        "signer_subject": cert.subject.human_friendly if cert else None,
                        "modified_after_signing": not (st.coverage and st.coverage.name == "ENTIRE_FILE"),
                        "summary": st.summary()})
        except Exception as e:
            out.append({"field": sig.field_name, "intact": False, "crypto_valid": False, "trusted": False,
                        "error": type(e).__name__, "modified_after_signing": None})
    return out
