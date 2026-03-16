# Aquifer Resource Metadata JSON

* **Author:** Rick Brannan (`rickb@missionmutual.org`)
* **Date:** 2025-10-15 (`1.0.0`)
* **Updated:** 2025-11-14 (`1.0.1`)
* **Updated:** 2025-11-21 (`1.0.2`). Introduce value `Bible` for `aquifer_type`, `resource_type`, and `content_type`.
* **Updated:** 2025-12-11 (`1.1.0`). Add `alignment_metadata` section.

# Introduction

[an introduction to appear here some time in the future]

# Terminology

This document uses vocabulary with specific meaning in the context of the Aquifer. These terms are:

* **Resource**: A **Resource** is a specific language version of a whole content piece. For example, the _Biblica Study Notes_ in English is a **Resource**. The _Biblica Study Notes_ in Arabic is a different resource.
* **Parent Resource**: A **Parent Resource** is the collection of all available languages of a particular content piece.
* **Resource Type**: The Aquifer presently defines the following **Resource Types**:
  * Bible
  * Study Notes
  * Bible Dictionaries
  * Translation Guides
  * Images
  * Videos
* **Article**: An **Article** is essentially a record within a non-Bible **Resource**. So the _Biblica Study Notes_ entry for “Genesis 1:1–2:25” is an **Article**.

# JSON

The JSON has three top-level sections:

* `resource_metadata`: Information about the resource itself. Titles, licensing information, localization information, etc.
* `scripture_burrito`: Resource metadata reformulated (and expanded where necessary) to be _mostly_ compliant with the [Scripture Burrito metadata specification](https://burrito.bible). 
* `article_metadata`: Information about each article (identifiers and sorting information) as well as localization information. The localization information includes identifiers of translations of the article in other languages. At present (2025-11-21) Bibles have no `article_metadata` as Bibles are provided as both USFM and USX, with supplementary audio information if available.
* `alignment_metadata`: Optional information about Bible alignments available in a resource of `type` Bible.

## `resource_metadata`

The `resource_metadata` is a dictionary that contains a large amount of resource-level information.

* `version`: The version of the JSON schema `aquifer_resource.schema.json` (located in `/schemas`) the metadata has been validated against. This is currently set at `1.0.2`. 
* `aquifer_type`: The database that drives the Aquifer has its own abbreviated resource typing. 
  * `Bible`
  * `StudyNotes`
  * `Images`
  * `Dictionary`
  * `Guide`
* `resource_type`: A string identifier providing the **Resource Type**. These identifiers are based on material from the [Strategic Languages Initiative](https://etenlab.notion.site/SLI-Resource-Types-00c9e1ce6d6c426b982e57819c045538). The following string identifiers are currently used and supported:
  * `Bible`
  * `Bible Dictionary`
  * `Comprehension Testing`
  * `Foundational Bible Stories`
  * `Images, Maps, Videos`
  * `Study Notes`
  * `Translation Glossary`
  * `Translation Guide`
* `aquifer_name`: 
* `collection_title`: 
* `collection_code`: 
* `short_name`: 
* `license_info`: A dictionary with properties defining copyright and licensing
  * `title`: The official title of the resource for licensing purposes
  * `copyright`: A dictionary with copyright information. Supports filling a template to create a copyright statement like: “Copyright © [dates] [holder/name]” where `holder/url` can be used to provide a link to the actual license.
    * `dates`: A string with copyright date Information
	* `holder`: A dictionary with `name` and `url` Information
  * `licenses`: A list of dictionaries with license information. Each list item is a dictionary with the following schema:
    * `eng`: a three-letter code representing the language of the Resource that serves as the key of a ditionary with `name` and `url` information (like the `copyright` dictionary described above).
  * `showAdaptationNoticeForEnglish`: boolean. If `true`, then (hopefully) the `adaptation_notice` property has the necessary statement.
  * `showAdaptationNoticeForNonEnglish`: boolean. If `true`, then (hopefully) the `adaptation_notice` property has the necessary statement.
* `adaptation_notice`: An HTML string (may be multiple paragraphs) with the adaptation notice.
* `date_created`: A `YYYY-MM-DD` formatted string providing the date that the resource information was exported and rendered into JSON.
* `language`: A three-letter code compatible with the ISO three-letter language codes.
* `localizations`: A list of three-letter language codes representing the languages that have any amount of localization data available for the resource.
* `order`: Provides the order of the resource. Three orders are supported:
  * `canonical`: The order of the resource follows that of the protestant canon. There are files for each included Bible book named based on the numeric position of the book in the canon. `01.json` is Genesis, which includes all resource articles for Genesis. `40.json` is Matthew, which includes all resource articles for Matthew.
  * `alphabetical`: The order of the resource is alphabetical. Each **Article** in the resource is a separate file, and files are named numerically (and padded to six digits to support easy sorting). So the first **Article** in the resource is `000001.json` (or `000001.md`)
  * `monograph`: The articles in the resource progress one from the other, like chapters and sections in a book. These as well are named like `000001.json` to provide a sorting order to the articles.
* `content_type`: Three possible types, `Html`, `Json`, or `Bible`. In practice, however, the `content_type` is usually `Html` for non-Bible resources. This indicates that the `content` section of the **Article** in resource JSON is encoded as HTML. Earlier unpublished prototypes of this data used `JSON`, which should be considered as deprecated.


## `scripture_burrito`

This metadata is influenced by the [Scripture Burrito metadata specification](https://burrito.bible) in order to provide compatibility (or near-compatibility) with applications that support the specification.

Note that while languages in Aquifer metadata use three-letter ISO codes, languages in Scripture Burrito metadata use two-letter ISO codes.

There are eight top-level properties, each of which may have lists or dictionaries with other properties.

* `format`: This is always `scripture_burrito`.
* `meta`: Information about the Resource
  * `version`: This is the version of the Scripture Burrito specification that this metadata follows. It will almost always be `1.0.0`.
  * `category`: This will always be `source`. 
* `idAuthorities`: A dictionary that declares identity authorities referenced later in the metadata. For the purposes of the Aquifer, we have introduced an authority of `aquifer`, which is the only identity authority referenced in the metadata. It is the key of the dictionary that contains further identity information.
  * `aquifer`: Identity key with dictionary as value.
    * `id`: This is an URL and will always be `https://aquifer.bible`.
	* `name`: A dictionary providing different language representations of the identity name.
	  * `en`: `Bible Aquifer`
* `identification`: The Aquifer resources only provide a `primary` identification other naming information.
  * `primary`: A dictionary with information about the resource `primary` identity.
    * `aquifer`: This is the identity key defined above. It contains a dictionary with further information about the resource.
	  * _resource-identifier_: This is an identifier for the resource, it will usually match the `resource_metadata/collection_code` key.
	    * _iso-date-string_: An ISO date-time string.
  * `name`: A dictionary ordered by language with language as key and name of the resource as value.
    * _language_: The relevant two-letter ISO language code
	  * _resource-name_: The name of the resource as a string, like `Biblica Study Notes`.
  * `abbreviation`: A dictionary ordered by language with language as key and abbreviation of the resource as value.
    * _language_: The relevant two-letter ISO language code
	  * _resource-abbreviation_: Standard abbreviation for the resource. The value will be the same as `resource_metadata/short_name`.
* `languages`: Lists the languages of the resource as a series of dictionaries with further information.
  * `tag`: The ISO two-letter code for the language (i.e. `en`)
  * `name`: A dictionary with the `tag` (`en`) as key and the expansion of the tag (`English`) as value.
     * _language_: The relevant two-letter ISO language code
	  * _language-name_: String representation of the language code 
* `type`: Information about the type of _Scripture Burrito_ the resource intendes to specify.
  * `flavorType`: A dictionary with information regarding how to process the Resource
    * `name`: The `name` of the Scripture Burrito type. For Aquifer documents, there are three possibilities:
	  * `scripture`: This is a Bible
	  * `parascriptural`: Usually non-Bible items that are ordered canonically
	  * `peripheral`: Items that can be classified as Biblical Studies related but not ordered canonically.
	* `flavor`: Each Scripture Burrito type has at least one `flavor` and possibly more. Each `flavor` has two properties:
	  * `name`: The `flavor` name. For these Aquifer resources, there are three possible flavors:
	    * `textAquiferCanonical`: Indicates the resource article sort order (canonical)
		* `textAquiferAlphabetical`: Indicates the resource article sort order (alphabetical)
		* `textAquiferMonograph`: Indicates the lack of resource article sort order
	  * `audience`: The audience is always `common`.
    * `currentScope`: Always an empty dictionary (`{}`)
* `ingredients`: Keeping with the “burrito” metaphor, The `ingredients` is a list of file information that make the resource (“burrito”). It is a list of dictionaries with the key representative of a relative file path (with base as `metadata.json`) and then further file information.
  * `folder/filename.ext`: The relative path to the file. Contains a dictionary with further file-level information.
    * `mimeType`: Supported values include: `text/json`, `text/markdown`, `application/pdf`, `application/word`.
	* `size`: Size in bytes of the file.
	* `scope`: For canonically-ordered resources, information about Bible books that is reflected within the current file.
* `copyright`: Information about copyright and licensing of the resource.
  * `licenses`: A list of dictionaries that provide a URL for each supported license.
  * `shortStatements`: A list of dictionaries with further information copyright and license statements. Each dictionary has the following possible keys:
    * `statement`: A string (for Aquifer resources in HTML) with copyright statement information.
	* `mimetype`: The `mimetype` of the copyright statement; `text/html` for Aquifer resources.
	  * (Yes, according the the Scripture Burrito spec and examples, here it is `mimetype` but above with file information it is `mimeType`.)
	* `lang`: The ISO two-letter code for the language of the copyright statement.


## `article_metadata`

The `article_metadata` consists of a list of keys to dictionaries that contain localization information about each article. The keys are resource article `content_id` values. They are also sorted in resource order, allowing reconstitution of the resource by article if necessary.

At present, Bibles do not have any article metadata.

This information is useful to navigate across localized editions of resources. It is also appropriate to use to train translation models that rely on parallel data.

* _content_id_: The resource article `content_id`. 
  * `content_id`: The `content_id`
  * `reference_id`: If the `content_id` is used in a reference in the aquifer, it may use the `reference_id` for navigation.
  * `index_reference`: The article sort key, essentially. For canonically-ordered resources, it is an eight-digit string representing the book, chapter, and verse of the Bible reference (`BBCCCVVV`). It may also indicate a range, with two references (`BBCCCVVV`–`BBCCCVVV`). For alphabetically-ordered resources, it is the sort key used (lower-cased article title, typically).
  * `localizations`: A list of dictionaries, one per available localized article. The initial key of the dictionary is the three-letter language identifier (e.g. `arb` for Arabic).
  * _language-id_: Each language has three pieces of information for the localized edition:
    * `content_id`: This is the `content_id` of the localized article.
	* _language-id_: This is the ISO three-letter language identifier used by the Aquifer.
	* `title`: This is the localized title of the article.

## `alignment_metadata`

The `alignment_metadata` is an optional section that provides information about Bible alignments available in a resource of `type` Bible.

* `alignment_source`: A URL string indicating the source (github repository) of the alignment data.
* `alignment_ot_basis`: A string indicating the edition/source/basis for the Old Testament alignment data. There are two possible values:
  * `WLCM`: The Westminster Leningrad Codex as implemented in Biblica's [Macula Hebrew](https://github.com/Clear-Bible/macula-hebrew) dataset.
  * `WLC`: The Westminster Leningrad Codex (unknown). No aligments currently use this basis.
* `alignment_nt_basis`: A string indicating the edition/source/basis for the New Testament alignment data. There are two possible values:
  * `SBLGNT`: _The SBL Greek New Testament_ as implemented in Biblica's [Macula Greek](https://github.com/Clear-Bible/macula-greek) dataset.
  * `GNTB`: _The Greek New Testament by Biblica_. No alignments currently use this basis. The edition is forthcoming.
* `licenses`: A list of dictionaries that provide a URL for each supported license.
* `target_token_differences`: A dictionary that indicates differences between Bible editions used as alignment targets. Generally, alignments in the Aquifer are imported from Biblica's available alignments. The Bible edition used by Biblica is compared to the Bible edition used by the Aquifer. The differences for tokens are included in this list.
