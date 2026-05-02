"""Walk seed/manuals/ and ingest each PDF if not already in the DB."""
import sys
from pathlib import Path

from app.database import SessionLocal
from app.services import document_ingester

SEED_DIR = Path("/app/seed/manuals")


def main() -> int:
    if not SEED_DIR.exists():
        print(f"[ingest_seed] {SEED_DIR} does not exist — nothing to do")
        return 0

    pdfs = sorted(p for p in SEED_DIR.iterdir() if p.suffix.lower() == ".pdf")
    if not pdfs:
        print("[ingest_seed] no PDFs found in seed/manuals/")
        return 0

    db = SessionLocal()
    try:
        for pdf in pdfs:
            print(f"[ingest_seed] processing {pdf.name}")
            try:
                doc = document_ingester.ingest(
                    db,
                    file_path=pdf,
                    filename=pdf.name,
                    storage_path=str(pdf),
                )
                print(f"[ingest_seed]   {pdf.name}: {doc.num_pages} pages, {doc.num_chunks} chunks")
            except Exception as exc:
                print(f"[ingest_seed]   FAILED {pdf.name}: {exc}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
