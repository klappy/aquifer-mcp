# Aquifer Article Metadata JSON

* **Author:** Rick Brannan (`rickb@missionmutual.org`)
* **Date:** 2025-10-16 (`1.0.0`)
* **Updated:** 2025-11-14 (`1.0.1`). Added `review_level` to schema.
* **Updated:** 2026-01-14 (`1.0.2`). `reference_id` and `associations` no longer required.
* **Updated:** 2026-02-25 (`1.0.3`). Added `acai` to `associations`.
* **Updated:** 2026-02-27. Revised `canonical` ACAI scoring formula; updated embedding model reference.
* **Updated:** 2026-02-27. Refined `scored` and `embedding` matching for alphabetical/monograph resources.
* **Updated:** 2026-03-05. Added `originalUrl` to Image article content; added `statement` to `license_info`.

# Introduction

[an introduction to appear here some time in the future]

# Terminology

This document uses vocabulary with specific meaning in the context of the Aquifer. These terms are:

* **Resource**: A **Resource** is a specific language version of a whole content piece. For example, the _Biblica Study Notes_ in English is a **Resource**. The _Biblica Study Notes_ in Arabic is a different resource.
* **Parent Resource**: A **Parent Resource** is the collection of all available languages of a particular content piece.
* **Resource Type**: The Aquifer presently defines the following **Resource Types**:
  * Bibles
  * Study Notes
  * Bible Dictionaries
  * Translation Guides
  * Images
  * Videos
* **Article**: An **Article** is essentially a record within a **Resource**. So the _Biblica Study Notes_ entry for “Genesis 1:1–2:25” is an **Article**.

# JSON

An aquifer content JSON file is a list of dictionaries, where each dictionary in the list contains article-level metadata and the article content.

For canonically-ordered resources, each content file represents the material of a book of the Bible. The files are named like `NN.content.(json|md)` where `NN` is the zero-padded Bible book number. So `01.content.json` is the data in JSON for Genesis, `40.content.md` is content for Matthew in Markdown, etc. 

For other resources (alphabetially ordered and monograph resources), each file, while still a list of articles, only contains information for one article. The files are named like `NNNNNN.content.(json|md)` If the files are sorted in an ascending order, the content of the resource will be in the proper order.

* `version`: The version of the JSON schema `aquifer_article.schema.json` (located in `/schemas`) the metadata has been validated against. This is currently set at `1.0.3`.
* `content_id`: The `content_id`
* `reference_id`: If the `content_id` is used in a reference in the aquifer, it may use the `reference_id` for navigation.
* `index_reference`: The article sort key, essentially. For canonically-ordered resources, it is an eight-digit string representing the book, chapter, and verse of the Bible reference (`BBCCCVVV`). It may also indicate a range, with two references (`BBCCCVVV`–`BBCCCVVV`). For alphabetically-ordered resources, it is the sort key used (lower-cased article title, typically).
* `media_type`: This is the media of the `content`. If the `content` is essentially a container pointing to an image, the `content` will be `Image`. Below are the supported `media_type` values:
  * `Text`
  * `Image`
  * `Video`
* `review_level`: Three possible levels: `None`, `Community`, `Professional`.
  * `None`: The article is as supplied from a content provider
  * `Community`: The article has community-level revisions
  * `Professional`: The article has had editorial attention from the Aquifer translation and editorial staff
* `language`: A three-letter code compatible with the ISO three-letter language codes.
* `content`: An HTML representation of the article content. For `Image` articles, the content includes the image, a download link, and optionally an `Original` link to the source (see `originalUrl` below). Some specialized elements (for linking and sometimes media) do occur; we will offer documentation of this HTML elsewhere. In the Markdown generated from this HTML, Bible references are enabled as links to Logos Bible Software's [ref.ly Bible reference linking system](https://ref.ly). This will probably change to something else, but for the short-term it provides a destination for these links.
* `associations`: This is article-level metadata regarding different types of links or relationships between this article and other articles. The "other articles" may be within the current resource, within a different resource, or to the Bible (by book, chapter, verse reference). Essentially, these are destinations you may be interested in examining based on the article. For _Study Notes_ resources, the reference of the note is usually included as a `passage` association. Many _Study Notes_ resources have related key-term style resources (typically implemented as sidebars or backmatter in print editions); these sorts of references are included as `resource` associations. Still to-do on `resource` associations: Include the resource name of the destination to facilitate easier link generation.
  * `passage`: Each item in the `passage` list has four items.
    * `start_ref`: The `BBCCCVVV` style reference of the starting Bible reference.
	* `start_ref_usfm`: The start reference rendered using standard USFM names.
	* `end_ref`: The `BBCCCVVV` style reference of the ending Bible reference. If the reference range is only one verse (e.g. "GEN 1:1"), then the `start_ref` and the `end_ref` will match.
	* `end_ref_usfm`: The end reference rendered using standard USFM names. If the reference range is only one verse (e.g. "GEN 1:1"), then the `start_ref_usfm` and the `end_ref_usfm` will match.
  * `resource`: Each item in the `resource` list has five items.
    * `reference_id`: An identifier for the unique reference itself.
	* `content_id`: The identifier of the article in the target resource.
	* `label`: A string representing a label for the article. If something clickable is needed for the link, this label can be used as the clickable content.
	* `language`: ISO three-letter code representing the language. This, plus the `resource_code` allow the destination to be easily specified in a manner consistent with how the material is laid out in the github repositories.
	* `resource_code`: The `resource_code` uniquely identifies the resource and is also the repository name for the resource in github.
  * `acai`: Optional. Each item in the `acai` list represents an association between this article and an entity in the [ACAI](https://github.com/BibleAquifer/ACAI) dataset. ACAI annotates explicit occurrences of named entities (people, places, groups, deities, flora, fauna, realia, and keyterms) in the Hebrew OT and Greek NT. Each item has five fields:
    * `id`: The ACAI entity identifier, combining entity type and name (e.g. `person:Aaron`, `place:Egypt`, `keyterm:Propitiation`).
    * `type`: The ACAI entity type. One of: `person`, `place`, `group`, `deity`, `flora`, `fauna`, `realia`, `keyterm`.
    * `preferred_label`: The preferred label for the entity in the language of the resource, falling back to the English label when no localized label is available.
    * `confidence`: A float between `0.0` and `1.0` indicating match confidence. A value of `1.0` indicates a direct link recorded in the ACAI data.
    * `match_method`: How the association was established. One of:
      * `content_id`: A direct link between this article's `content_id` and the ACAI entity was found in the ACAI data. Confidence is always `1.0`.
      * `canonical`: For canonically-ordered resources, the entity has at least one explicit attestation within the article's scripture reference range (`index_reference`). All such entities are included; confidence reflects their prominence in the passage using a weighted combination of: **concentration** (fraction of passage verses containing the entity), **occurrence count** (normalised), **key-reference density** (how many of the entity's key references fall within the range, relative to range size), and **entity type** (deity/person/group/place/keyterm weighted higher than flora/fauna/realia). Confidence is used for ranking only — there is no minimum threshold.
      * `scored`: For alphabetically-ordered and monograph resources, a weighted combination of label similarity and passage reference overlap. Label matching is sensitive to title length: single-token titles (proper names) use strict edit-distance similarity with a high minimum threshold to prevent co-occurring similarly-spelled names (e.g. "Bigtha" and "Biztha") from matching; multi-token titles use token-sorted fuzzy matching with a lower threshold to accommodate word-order variation in phrase titles.
      * `embedding`: Fallback for alphabetically-ordered resources when no scored matches meet the threshold. Uses multilingual sentence-embedding cosine similarity between the article title and entity labels. Only attempted for titles of 4 or more characters; scores are adjusted by a length ratio penalty to prevent short titles from spuriously matching longer entity labels that share subword tokens.

# Resource Metadata

The `metadata.json` file accompanying each resource's converted output contains a `resource_metadata` section with the following notable fields:

* `license_info`: License and copyright information for the resource. Contains the standard Aquifer license fields (`title`, `copyright`, `licenses`). May also contain:
  * `copyright.statement` *(optional)*: A specific copyright/license statement provided by the content owner. When present, downstream renderers (markdown, PDF title page) use this statement directly instead of constructing a generic "is based on and adapted from" sentence.

# Image Article Content Fields

Image articles (`media_type: "Image"`) are sourced from Aquifer API export files that may include the following optional field in the article's `content/content` object:

* `originalUrl` *(optional)*: A URL pointing to the original source of the image (e.g. the content owner's website or media library). When present, the render stage appends an `Original:` link after the standard download link in the article's HTML content.