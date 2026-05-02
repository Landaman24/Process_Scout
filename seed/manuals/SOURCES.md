# Seed Document Corpus — Sources & Licensing

All committed PDFs are **public domain** by virtue of being authored by U.S. federal employees in the course of their official duties (17 U.S.C. § 105). No proprietary or copyrighted OEM material is included in this directory.

## Committed PDFs

| Filename | Source | Coverage |
|---|---|---|
| `DOE_Compressed_Air_Sourcebook.pdf` | [DOE / NREL — *Improving Compressed Air System Performance: A Sourcebook for Industry*](https://www.energy.gov/sites/default/files/2014/05/f16/compressed_air_sourcebook.pdf) | Air compressor systems |
| `DOE_Pumping_System_Sourcebook.pdf` | [DOE — *Improving Pumping System Performance: A Sourcebook for Industry, 2nd Ed.*](https://www.energy.gov/sites/prod/files/2014/05/f16/pump.pdf) | Pumps + pumping systems |
| `Army_TM_5-685_Auxiliary_Generators.pdf` | [Army TM 5-685 / NAVFAC MO-912 — *Operation, Maintenance, and Repair of Auxiliary Generators*](https://armypubs.army.mil/epubs/DR_pubs/DR_a/pdf/web/tm5_685.pdf) | Generators + gensets |

## Manual-download required

| Filename (target) | Source | Why manual |
|---|---|---|
| `USACE_EM_1110-2-3105_Pumping_Stations.pdf` | [USACE EM 1110-2-3105 — *Mechanical and Electrical Design of Pumping Stations*](https://www.publications.usace.army.mil/portals/76/publications/engineermanuals/em_1110-2-3105.pdf) | The USACE publications portal sits behind an Akamai bot-protection layer that rejects programmatic downloads. Browsers pass through fine. Download manually from the link and drop the PDF here. Covers VFDs + soft starts (motor-control chapters). |

## Adding more documents

Drop any additional **public-domain or open-licensed** PDFs in this directory. Update this file with the source URL and a one-line coverage note. The ingestion pipeline (task #5) will pick them up automatically on its next run.

**License gate:** before committing a PDF, confirm one of:
- Authored by U.S. federal employees in their official capacity (automatically public domain)
- Pre-1929 publication (now in public domain by age)
- Explicitly placed in public domain or licensed under CC0 / CC-BY / similar permissive terms

If in doubt, treat the document as the live-demo upload pattern: use it during the demo, never commit it.
