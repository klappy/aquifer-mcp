# Aquifer Window — Stewardship Fly Inventory

**Session:** local_8e124453-f3d9-4276-bcb6-dceedf4b605d (Fable, 2026-07-07)
**Surface:** https://aquifer-window.klappy.dev
**Custody:** **NO source repository exists** — verified independently this fly (404 under `klappy/` and all candidate orgs: eten-ai, eten-lab, eten-innovation-lab, etenbible, etenlab, aquifer-bible, unfoldingWord; global GitHub search: zero hits). Confirms both persistent CDO memory ("Lovable-hosted, changes via captain's Lovable PRDs") and the charters fly's independent verification. **Two independent Fables have now verified this; it should never be re-litigated — it's in memory.**
**Genre:** maintenance, probe-and-parity variant (steward watches a surface it cannot write to)

## Probe results (2026-07-07T03:00Z)

| Check | Result |
|---|---|
| `GET /` | HTTP 200 (SPA shell renders) |
| `GET /pulse` | HTTP 200 |
| Backend (`aquifer.klappy.dev`) | ok, v1.6.2 — the Window's content API is healthy |
| Parity exposure | Backend `list` grew 35→57 resources (14 languages) since 1.6.1; whether the Window surfaces the multilingual corpus gracefully is **untestable from curl** — needs a human/browser pass |

## can-finish-here

- Probe-and-parity ride-alongs like the above — done this fly. That is the entire writable surface.

## needs-captain-ratification

1. **The §0 custody ruling from the charter draft** (the one decision that reshapes everything): enable Lovable GitHub sync/export so the Window gains a stewardable repo. Until then every Window defect is a captain interrupt by construction.
2. **Parity check PRD candidate**: the backend now serves 22 more resources and 13 more languages than when the Window was last touched (its Lovable brief predates 1.6.x). If the Window's UI assumes an English-only, 35-resource corpus anywhere (filters, language pickers, list pagination), that's PRD material. Drafting a Lovable PRD requires eyes on the rendered app — beyond this fly's curl-only reach.

## blocked-external

- Everything code-shaped: hosting, deps, auth (Lovable's OAuth client), DNS — all Lovable-side.

## release-candidate

- Not applicable — no repo, no releases. "Release" for the Window = captain firing a Lovable PRD.
