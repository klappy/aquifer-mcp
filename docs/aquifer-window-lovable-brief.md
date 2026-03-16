# Aquifer Window (Aquarium) — Lovable Brief

**Date**: March 16, 2026
**Builder**: Lovable (AI frontend builder)
**Data source**: Bible Aquifer GitHub repos (`github.com/BibleAquifer`)
**Companion**: `aquifer-mcp-oldc.md`, `aquifer-mcp-handoff.md`

---

## What This Is

A lightweight, visually appealing resource explorer for the Bible Aquifer. Think of it as a window into the Aquifer — or an aquarium where you can see all the resources swimming around and pick one to examine.

Rick Brannan already built a static HTML catalog page that refreshes nightly. This is that idea done properly: interactive, searchable, browsable, and beautiful.

**No backend. No database. No auth.** Just a frontend that fetches from GitHub and presents what's there.

---

## Data Source

All data comes from the BibleAquifer GitHub org: `github.com/BibleAquifer`

Each resource is its own repo. Each repo contains:
- `{language}/metadata.json` — resource-level metadata + article index
- `{language}/json/*.content.json` — article content (JSON with HTML content field)
- `{language}/markdown/*.content.md` — article content (Markdown)

The docs repo (`BibleAquifer/docs`) has schemas and documentation.

### Key URLs

- GitHub org: `https://github.com/BibleAquifer`
- Raw content: `https://raw.githubusercontent.com/BibleAquifer/{repo}/main/{language}/{path}`
- GitHub API (repo list): `https://api.github.com/orgs/BibleAquifer/repos`

---

## What It Should Show

### Landing / Browse View

Show all available resources in a clean grid or list. For each resource:
- Resource name and type (Study Notes, Bible Dictionary, Translation Guide, Images, Videos, Bible)
- Publisher / copyright holder
- Available languages with completion percentages
- Article count
- License type (CC0, CC-BY, CC-BY-SA)

Group by resource type. Allow filtering by type and language.

Data source: fetch `metadata.json` from each repo's primary language folder.

### Resource Detail View

When you click a resource, show:
- Full metadata (title, publisher, license, date, description)
- Language selector showing all available localizations with completion %
- Article list for the selected language, browsable and searchable
- For canonical resources (Study Notes, Translation Guides): organize by Bible book
- For alphabetical resources (Dictionaries, Key Terms): A-Z navigation
- For monograph resources: sequential table of contents

Data source: `article_metadata` section from `metadata.json`, plus content files on demand.

### Article View

When you click an article:
- Render the HTML content cleanly
- Show passage associations as clickable Bible references
- Show resource associations as links to other articles (with resource name and label)
- Show ACAI entity associations as tags (person, place, keyterm, etc.) with confidence indicators
- Show review level badge (None / Community / Professional)
- Show localization links (same article in other languages)

Data source: the specific `*.content.json` file for that article.

### Search

- Search by Bible reference (type "Romans 3:24" → find all articles covering that verse across all resources)
- Search by article title / content
- Search by ACAI entity ("justification", "Paul", "Jerusalem")

This requires building a client-side index from the article_metadata across repos. Could use a service worker or build the index on first load and cache it.

---

## Technical Notes

### Bible Reference Format

Aquifer uses BBCCCVVV format internally:
- BB = book number (01-66, Protestant canon order)
- CCC = chapter (001-150)  
- VVV = verse (001-176)

Example: `45003024` = Romans 3:24

The search should accept human-readable input ("Romans 3:24", "ROM 3:24", "Gen 1:1") and convert to BBCCCVVV for lookup.

USFM book abbreviations are also available in the data (`start_ref_usfm`, `end_ref_usfm`).

### Resource Types

From the schema's `aquifer_type` enum:
- `Bible` — full Bible text
- `StudyNotes` — verse-level or passage-level commentary
- `Dictionary` — alphabetical reference entries
- `Guide` — translation guidance
- `Images` — visual resources (maps, illustrations)
- `Videos` — video resources

### Ordering Schemes

From the schema's `order` enum:
- `canonical` — files named `NN.content.json` (01-66 by Bible book)
- `alphabetical` — files named `NNNNNN.content.json` (six-digit, sorted)
- `monograph` — same naming as alphabetical, sequential order

### Content Format

Article `content` fields are HTML fragments. Render them directly. They include:
- Bible reference links (currently pointing to ref.ly — could be made internal)
- Standard HTML formatting (headings, paragraphs, emphasis, lists)
- Image articles contain download links and optionally an original source link

### Existing Schema Documentation

Include in the Lovable project context:
- `aquifer_resource_metadata.md` — explains all resource-level fields
- `aquifer_article_metadata.md` — explains all article-level fields, association types, ACAI matching
- `aquifer_resource_schema.json` (v1.1.2) — resource metadata JSON schema
- `aquifer_article_schema.json` (v1.0.3) — article content JSON schema
- `aquifer_full_inventory.md` — complete list of resources with localization data

---

## Design Direction

- **Light and clear.** Water/aquifer theme is fine but subtle — this is a professional tool for Bible translation organizations, not a novelty.
- **Fast.** Lazy-load content. Show the index immediately, fetch article content on demand.
- **Respect the data.** Show what's there accurately. Don't invent metadata that doesn't exist. Surface review levels, licenses, and completion percentages honestly.
- **Mobile-friendly.** Translators in the field may access this on phones.
- **No login required.** Everything in the Aquifer is open-licensed. No gates.

---

## What This Is NOT

- Not a Bible reading app (that's Bible Well / `app.well.bible`)
- Not an API (that's the MCP server)
- Not a content editor (Rick's pipeline handles that)
- Not a replacement for Rick's catalog page — it's an upgrade of the same idea
