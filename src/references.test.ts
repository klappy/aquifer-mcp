import { describe, it, expect } from "vitest";
import {
  parseReference,
  isValidIndexReference,
  rangesOverlap,
  bbcccvvvToReadable,
  rangeToReadable,
} from "./references.js";

describe("parseReference", () => {
  it("parses raw BBCCCVVV", () => {
    expect(parseReference("45003024")).toBe("45003024");
  });

  it("parses BBCCCVVV range", () => {
    expect(parseReference("45003021-45003031")).toBe("45003021-45003031");
  });

  it("parses USFM format (ROM 3:24)", () => {
    expect(parseReference("ROM 3:24")).toBe("45003024");
  });

  it("parses USFM range (ROM 3:24-26)", () => {
    expect(parseReference("ROM 3:24-26")).toBe("45003024-45003026");
  });

  it("parses human-readable (Romans 3:24)", () => {
    expect(parseReference("Romans 3:24")).toBe("45003024");
  });

  it("parses Genesis 1:1", () => {
    expect(parseReference("GEN 1:1")).toBe("01001001");
  });

  it("parses 1 Corinthians reference", () => {
    expect(parseReference("1CO 13:1")).toBe("46013001");
  });

  it("returns null for non-reference strings", () => {
    expect(parseReference("hello world")).toBeNull();
    expect(parseReference("keyterm:Justification")).toBeNull();
    expect(parseReference("")).toBeNull();
    expect(parseReference("market")).toBeNull();
    expect(parseReference("hello")).toBeNull();
  });

  it("parses case-insensitively", () => {
    expect(parseReference("rom 3:24")).toBe("45003024");
    expect(parseReference("romans 3:24")).toBe("45003024");
  });

  it("parses USFM chapter only (MRK 4)", () => {
    expect(parseReference("MRK 4")).toBe("41004001-41004999");
  });

  it("parses name chapter only (Mark 4)", () => {
    expect(parseReference("Mark 4")).toBe("41004001-41004999");
  });

  it("parses chapter only case-insensitively", () => {
    expect(parseReference("mark 4")).toBe("41004001-41004999");
    expect(parseReference("mrk 4")).toBe("41004001-41004999");
  });

  it("parses USFM chapter range (MRK 4-6)", () => {
    expect(parseReference("MRK 4-6")).toBe("41004001-41006999");
  });

  it("parses name chapter range (Mark 4-6)", () => {
    expect(parseReference("Mark 4-6")).toBe("41004001-41006999");
  });

  it("parses chapter range with en-dash", () => {
    expect(parseReference("Mark 4\u20136")).toBe("41004001-41006999");
  });

  it("parses USFM book only (MRK)", () => {
    expect(parseReference("MRK")).toBe("41001001-41999999");
  });

  it("parses name book only (Mark)", () => {
    expect(parseReference("Mark")).toBe("41001001-41999999");
  });

  it("parses book only case-insensitively", () => {
    expect(parseReference("mark")).toBe("41001001-41999999");
    expect(parseReference("mrk")).toBe("41001001-41999999");
  });

  it("parses numbered book names (1 Corinthians 13)", () => {
    expect(parseReference("1 Corinthians 13")).toBe("46013001-46013999");
  });

  it("parses numbered USFM book only (1CO)", () => {
    expect(parseReference("1CO")).toBe("46001001-46999999");
  });

  it("parses Psalm 119 (chapter only)", () => {
    expect(parseReference("Psalm 119")).toBe("19119001-19119999");
  });

  it("parses Romans 1-3 (chapter range)", () => {
    expect(parseReference("Romans 1-3")).toBe("45001001-45003999");
  });

  it("parses Jude (single-chapter book, book only)", () => {
    expect(parseReference("Jude")).toBe("65001001-65999999");
  });

  it("parses 3 John (numbered book only)", () => {
    expect(parseReference("3 John")).toBe("64001001-64999999");
  });

  it("parses Revelation book only", () => {
    expect(parseReference("Revelation")).toBe("66001001-66999999");
  });

  it("parses Genesis 1 (chapter only)", () => {
    expect(parseReference("Genesis 1")).toBe("01001001-01001999");
  });

  // --- Abbreviation tests (v1.0.0) ---

  it("parses common abbreviation 'Rom 3:24'", () => {
    expect(parseReference("Rom 3:24")).toBe("45003024");
  });

  it("parses short abbreviation 'Ro 3:24'", () => {
    expect(parseReference("Ro 3:24")).toBe("45003024");
  });

  it("parses 'Jn 3:16'", () => {
    expect(parseReference("Jn 3:16")).toBe("43003016");
  });

  it("parses 'Gen 1:1'", () => {
    expect(parseReference("Gen 1:1")).toBe("01001001");
  });

  it("parses 'Mt 5:1'", () => {
    expect(parseReference("Mt 5:1")).toBe("40005001");
  });

  it("parses 'Mk 4' (chapter only with abbreviation)", () => {
    expect(parseReference("Mk 4")).toBe("41004001-41004999");
  });

  it("parses 'Lk 2:1-20' (abbreviation with range)", () => {
    expect(parseReference("Lk 2:1-20")).toBe("42002001-42002020");
  });

  it("parses 'Heb 11:1'", () => {
    expect(parseReference("Heb 11:1")).toBe("58011001");
  });

  it("parses 'Ps 23' (chapter only)", () => {
    expect(parseReference("Ps 23")).toBe("19023001-19023999");
  });

  it("parses 'Rev 1' (abbreviation chapter only)", () => {
    expect(parseReference("Rev 1")).toBe("66001001-66001999");
  });

  it("parses '1 Cor 13:1' (numbered abbreviation)", () => {
    expect(parseReference("1 Cor 13:1")).toBe("46013001");
  });

  it("parses 'Eph 2:8-9'", () => {
    expect(parseReference("Eph 2:8-9")).toBe("49002008-49002009");
  });

  it("parses 'Gal 5:22'", () => {
    expect(parseReference("Gal 5:22")).toBe("48005022");
  });

  it("parses Spanish 'Romanos 3:24'", () => {
    expect(parseReference("Romanos 3:24")).toBe("45003024");
  });

  it("parses French 'Jean 3:16'", () => {
    expect(parseReference("Jean 3:16")).toBe("43003016");
  });

  it("parses 'Ac 2:1' (Acts abbreviation)", () => {
    expect(parseReference("Ac 2:1")).toBe("44002001");
  });

  it("parses 'Phil 4:13'", () => {
    expect(parseReference("Phil 4:13")).toBe("50004013");
  });
});

describe("isValidIndexReference", () => {
  it("accepts valid BBCCCVVV", () => {
    expect(isValidIndexReference("45003024")).toBe(true);
  });

  it("accepts valid BBCCCVVV range", () => {
    expect(isValidIndexReference("45003021-45003031")).toBe(true);
  });

  it("rejects title strings", () => {
    expect(isValidIndexReference("abram's journey from ur to canaan")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidIndexReference("")).toBe(false);
  });

  it("rejects short strings", () => {
    expect(isValidIndexReference("4500302")).toBe(false);
  });
});

describe("rangesOverlap", () => {
  it("detects single verse within range", () => {
    expect(rangesOverlap("45003024", "45003021-45003031")).toBe(true);
  });

  it("detects overlapping ranges", () => {
    expect(rangesOverlap("45003020-45003025", "45003021-45003031")).toBe(true);
  });

  it("detects exact match", () => {
    expect(rangesOverlap("45003024", "45003024")).toBe(true);
  });

  it("rejects non-overlapping ranges", () => {
    expect(rangesOverlap("45003001-45003010", "45003021-45003031")).toBe(false);
  });

  it("rejects different books", () => {
    expect(rangesOverlap("01001001", "45003024")).toBe(false);
  });
});

describe("bbcccvvvToReadable", () => {
  it("converts to USFM-style readable", () => {
    expect(bbcccvvvToReadable("45003024")).toBe("ROM 3:24");
  });

  it("converts Genesis", () => {
    expect(bbcccvvvToReadable("01001001")).toBe("GEN 1:1");
  });

  it("converts Revelation", () => {
    expect(bbcccvvvToReadable("66022021")).toBe("REV 22:21");
  });
});

describe("rangeToReadable", () => {
  it("formats single reference", () => {
    expect(rangeToReadable("45003024")).toBe("ROM 3:24");
  });

  it("formats same-chapter range", () => {
    expect(rangeToReadable("45003021-45003031")).toBe("ROM 3:21-31");
  });

  it("formats cross-chapter range", () => {
    expect(rangeToReadable("45001001-45002029")).toBe("ROM 1:1-2:29");
  });

  it("formats book-only sentinel range", () => {
    expect(rangeToReadable("41001001-41999999")).toBe("MRK");
  });

  it("formats chapter-only sentinel range", () => {
    expect(rangeToReadable("41004001-41004999")).toBe("MRK 4");
  });

  it("formats chapter-range sentinel range", () => {
    expect(rangeToReadable("41004001-41006999")).toBe("MRK 4-6");
  });

  it("formats Psalms book-only sentinel", () => {
    expect(rangeToReadable("19001001-19999999")).toBe("PSA");
  });

  it("formats Psalm 119 chapter sentinel", () => {
    expect(rangeToReadable("19119001-19119999")).toBe("PSA 119");
  });
});

describe("rangesOverlap with sentinel ranges", () => {
  it("chapter sentinel overlaps verse in same chapter", () => {
    expect(rangesOverlap("41004001-41004999", "41004020-41004020")).toBe(true);
  });

  it("chapter sentinel does not overlap next chapter", () => {
    expect(rangesOverlap("41004001-41004999", "41005001-41005001")).toBe(false);
  });

  it("book sentinel overlaps any verse in the book", () => {
    expect(rangesOverlap("41001001-41999999", "41016020-41016020")).toBe(true);
  });

  it("book sentinel does not overlap next book", () => {
    expect(rangesOverlap("41001001-41999999", "42001001-42001001")).toBe(false);
  });

  it("chapter range sentinel overlaps verse within range", () => {
    expect(rangesOverlap("41004001-41006999", "41005010-41005010")).toBe(true);
  });

  it("chapter range sentinel does not overlap outside range", () => {
    expect(rangesOverlap("41004001-41006999", "41007001-41007001")).toBe(false);
  });
});

describe("parseReference with accented multi-language aliases", () => {
  it("parses Spanish 'Génesis 1:1'", () => {
    expect(parseReference("Génesis 1:1")).toBe("01001001");
  });

  it("parses Portuguese 'João 3:16'", () => {
    expect(parseReference("João 3:16")).toBe("43003016");
  });

  it("parses French 'Lévitique 19:18'", () => {
    expect(parseReference("Lévitique 19:18")).toBe("03019018");
  });

  it("parses Spanish 'Éxodo 20:1-17'", () => {
    expect(parseReference("Éxodo 20:1-17")).toBe("02020001-02020017");
  });

  it("parses Spanish 'Números 6'", () => {
    expect(parseReference("Números 6")).toBe("04006001-04006999");
  });

  it("parses French 'Deutéronome 6:4'", () => {
    expect(parseReference("Deutéronome 6:4")).toBe("05006004");
  });

  it("parses Spanish 'Josué' as whole book", () => {
    expect(parseReference("Josué")).toBe("06001001-06999999");
  });

  it("parses French 'Éphésiens 2:8'", () => {
    expect(parseReference("Éphésiens 2:8")).toBe("49002008");
  });

  it("parses Spanish 'Gálatas 5:22'", () => {
    expect(parseReference("Gálatas 5:22")).toBe("48005022");
  });

  it("parses French 'Hébreux 11:1'", () => {
    expect(parseReference("Hébreux 11:1")).toBe("58011001");
  });
});
