export interface Env {
  AQUIFER_CACHE: KVNamespace;
  AQUIFER_ORG: string;
  DOCS_REPO: string;
}

export interface ResourceEntry {
  resource_code: string;
  aquifer_type: string;
  resource_type: string;
  title: string;
  short_name: string;
  order: "canonical" | "alphabetical" | "monograph";
  language: string;
  localizations: string[];
  article_count: number;
  version: string;
}

export interface ArticleRef {
  resource_code: string;
  language: string;
  content_id: string;
  title: string;
  resource_type: string;
  index_reference?: string;
}

export interface PassageAssociation {
  start_ref: string;
  start_ref_usfm: string;
  end_ref: string;
  end_ref_usfm: string;
}

export interface ResourceAssociation {
  reference_id: number;
  content_id: number | string;
  resource_code: string;
  label: string;
  language: string;
}

export interface AcaiAssociation {
  id: string;
  type: string;
  preferred_label: string;
  confidence: number;
  match_method: string;
}

export interface ArticleContent {
  content_id: string;
  reference_id: number;
  version: string;
  title: string;
  media_type: string;
  index_reference: string;
  language: string;
  review_level: string;
  content: string;
  associations: {
    passage: PassageAssociation[];
    resource: ResourceAssociation[];
    acai: AcaiAssociation[];
  };
}

export interface ArticleMetadataEntry {
  content_id: string;
  reference_id: number;
  index_reference: string;
  title?: string;
  localizations?: Record<string, { content_id: number; language: string; title: string }>;
}

export interface ResourceMetadata {
  resource_metadata: {
    aquifer_type: string;
    resource_type: string;
    title: string;
    aquifer_name: string;
    version: string;
    short_name: string;
    resource_code: string;
    language: string;
    localizations: string[];
    order: "canonical" | "alphabetical" | "monograph";
    content_type: string;
    license_info?: {
      title: string;
      copyright: { dates: string; holder: { name: string; url: string } };
      licenses: Array<Record<string, { name: string; url: string }>>;
    };
    adaptation_notice?: string;
  };
  scripture_burrito?: {
    ingredients?: Record<string, unknown>;
  };
  article_metadata: Record<string, ArticleMetadataEntry>;
}

export interface NavigabilityIndex {
  registry: ResourceEntry[];
  passage: Map<string, ArticleRef[]>;
  entity: Map<string, ArticleRef[]>;
  title: ArticleRef[];
  built_at: number;
}
