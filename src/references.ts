const USFM_TO_BOOK_NUM: Record<string, string> = {
  GEN: "01", EXO: "02", LEV: "03", NUM: "04", DEU: "05",
  JOS: "06", JDG: "07", RUT: "08", "1SA": "09", "2SA": "10",
  "1KI": "11", "2KI": "12", "1CH": "13", "2CH": "14", EZR: "15",
  NEH: "16", EST: "17", JOB: "18", PSA: "19", PRO: "20",
  ECC: "21", SNG: "22", ISA: "23", JER: "24", LAM: "25",
  EZK: "26", DAN: "27", HOS: "28", JOL: "29", AMO: "30",
  OBA: "31", JON: "32", MIC: "33", NAM: "34", HAB: "35",
  ZEP: "36", HAG: "37", ZEC: "38", MAL: "39", MAT: "40",
  MRK: "41", LUK: "42", JHN: "43", ACT: "44", ROM: "45",
  "1CO": "46", "2CO": "47", GAL: "48", EPH: "49", PHP: "50",
  COL: "51", "1TH": "52", "2TH": "53", "1TI": "54", "2TI": "55",
  TIT: "56", PHM: "57", HEB: "58", JAS: "59", "1PE": "60",
  "2PE": "61", "1JN": "62", "2JN": "63", "3JN": "64", JUD: "65",
  REV: "66",
};

const BOOK_NUM_TO_USFM: Record<string, string> = Object.fromEntries(
  Object.entries(USFM_TO_BOOK_NUM).map(([k, v]) => [v, k])
);

const BOOK_NAME_TO_USFM: Record<string, string> = {
  genesis: "GEN", exodus: "EXO", leviticus: "LEV", numbers: "NUM",
  deuteronomy: "DEU", joshua: "JOS", judges: "JDG", ruth: "RUT",
  "1 samuel": "1SA", "2 samuel": "2SA", "1 kings": "1KI", "2 kings": "2KI",
  "1 chronicles": "1CH", "2 chronicles": "2CH", ezra: "EZR", nehemiah: "NEH",
  esther: "EST", job: "JOB", psalms: "PSA", psalm: "PSA", proverbs: "PRO",
  ecclesiastes: "ECC", "song of solomon": "SNG", "song of songs": "SNG",
  isaiah: "ISA", jeremiah: "JER", lamentations: "LAM", ezekiel: "EZK",
  daniel: "DAN", hosea: "HOS", joel: "JOL", amos: "AMO", obadiah: "OBA",
  jonah: "JON", micah: "MIC", nahum: "NAM", habakkuk: "HAB",
  zephaniah: "ZEP", haggai: "HAG", zechariah: "ZEC", malachi: "MAL",
  matthew: "MAT", mark: "MRK", luke: "LUK", john: "JHN", acts: "ACT",
  romans: "ROM", "1 corinthians": "1CO", "2 corinthians": "2CO",
  galatians: "GAL", ephesians: "EPH", philippians: "PHP", colossians: "COL",
  "1 thessalonians": "1TH", "2 thessalonians": "2TH",
  "1 timothy": "1TI", "2 timothy": "2TI", titus: "TIT", philemon: "PHM",
  hebrews: "HEB", james: "JAS", "1 peter": "1PE", "2 peter": "2PE",
  "1 john": "1JN", "2 john": "2JN", "3 john": "3JN", jude: "JUD",
  revelation: "REV", revelations: "REV",
};

export function parseBBCCCVVV(ref: string): { book: string; chapter: number; verse: number } | null {
  if (ref.length !== 8) return null;
  const book = ref.slice(0, 2);
  const chapter = parseInt(ref.slice(2, 5), 10);
  const verse = parseInt(ref.slice(5, 8), 10);
  if (!BOOK_NUM_TO_USFM[book] || isNaN(chapter) || isNaN(verse)) return null;
  return { book, chapter, verse };
}

export function toBBCCCVVV(book: string, chapter: number, verse: number): string {
  return `${book}${String(chapter).padStart(3, "0")}${String(verse).padStart(3, "0")}`;
}

export function parseReference(input: string): string | null {
  const trimmed = input.trim();

  if (/^\d{8}$/.test(trimmed)) {
    return parseBBCCCVVV(trimmed) ? trimmed : null;
  }

  if (/^\d{8}-\d{8}$/.test(trimmed)) {
    const [start, end] = trimmed.split("-");
    if (start && end && parseBBCCCVVV(start) && parseBBCCCVVV(end)) return trimmed;
    return null;
  }

  const usfmMatch = trimmed.match(/^(\d?[A-Z]{2,3})\s+(\d{1,3}):(\d{1,3})(?:\s*[-–]\s*(\d{1,3}):(\d{1,3})|(?:\s*[-–]\s*(\d{1,3})))?$/i);
  if (usfmMatch) {
    const [, bookCode, chStr, vStr, endChStr, endVStr, sameChEndV] = usfmMatch;
    if (!bookCode || !chStr || !vStr) return null;
    const usfm = bookCode.toUpperCase();
    const bookNum = USFM_TO_BOOK_NUM[usfm];
    if (!bookNum) return null;

    const ch = parseInt(chStr, 10);
    const v = parseInt(vStr, 10);
    const start = toBBCCCVVV(bookNum, ch, v);

    if (endChStr && endVStr) {
      return `${start}-${toBBCCCVVV(bookNum, parseInt(endChStr, 10), parseInt(endVStr, 10))}`;
    }
    if (sameChEndV) {
      return `${start}-${toBBCCCVVV(bookNum, ch, parseInt(sameChEndV, 10))}`;
    }
    return start;
  }

  const nameMatch = trimmed.match(/^(\d?\s*[a-zA-Z]+(?:\s+[a-zA-Z]+)?)\s+(\d{1,3}):(\d{1,3})(?:\s*[-–]\s*(\d{1,3}):(\d{1,3})|(?:\s*[-–]\s*(\d{1,3})))?$/i);
  if (nameMatch) {
    const [, bookName, chStr, vStr, endChStr, endVStr, sameChEndV] = nameMatch;
    if (!bookName || !chStr || !vStr) return null;
    const normalized = bookName.toLowerCase().trim();
    const usfm = BOOK_NAME_TO_USFM[normalized];
    if (!usfm) return null;
    const bookNum = USFM_TO_BOOK_NUM[usfm];
    if (!bookNum) return null;

    const ch = parseInt(chStr, 10);
    const v = parseInt(vStr, 10);
    const start = toBBCCCVVV(bookNum, ch, v);

    if (endChStr && endVStr) {
      return `${start}-${toBBCCCVVV(bookNum, parseInt(endChStr, 10), parseInt(endVStr, 10))}`;
    }
    if (sameChEndV) {
      return `${start}-${toBBCCCVVV(bookNum, ch, parseInt(sameChEndV, 10))}`;
    }
    return start;
  }

  return null;
}

export function isValidIndexReference(range: string): boolean {
  if (/^\d{8}$/.test(range)) {
    return parseBBCCCVVV(range) !== null;
  }
  if (/^\d{8}-\d{8}$/.test(range)) {
    const [start, end] = range.split("-");
    return Boolean(start && end && parseBBCCCVVV(start) && parseBBCCCVVV(end));
  }
  return false;
}

export function rangesOverlap(a: string, b: string): boolean {
  if (!isValidIndexReference(a) || !isValidIndexReference(b)) return false;
  const [aStart, aEnd] = a.includes("-") ? a.split("-") : [a, a];
  const [bStart, bEnd] = b.includes("-") ? b.split("-") : [b, b];
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return aStart <= bEnd && bStart <= aEnd;
}

export function bbcccvvvToReadable(ref: string): string {
  const parsed = parseBBCCCVVV(ref);
  if (!parsed) return ref;
  const usfm = BOOK_NUM_TO_USFM[parsed.book];
  if (!usfm) return ref;
  return `${usfm} ${parsed.chapter}:${parsed.verse}`;
}

export function rangeToReadable(range: string): string {
  if (!range.includes("-")) return bbcccvvvToReadable(range);
  const [start, end] = range.split("-");
  if (!start || !end) return range;
  const s = parseBBCCCVVV(start);
  const e = parseBBCCCVVV(end);
  if (!s || !e) return range;
  const usfm = BOOK_NUM_TO_USFM[s.book];
  if (!usfm) return range;
  if (s.book === e.book && s.chapter === e.chapter) {
    return `${usfm} ${s.chapter}:${s.verse}-${e.verse}`;
  }
  if (s.book === e.book) {
    return `${usfm} ${s.chapter}:${s.verse}-${e.chapter}:${e.verse}`;
  }
  return `${bbcccvvvToReadable(start)}-${bbcccvvvToReadable(end)}`;
}

export function bookNumToFileNum(bookNum: string): string {
  return bookNum;
}
