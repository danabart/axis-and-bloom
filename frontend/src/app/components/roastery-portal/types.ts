// Roastery portal (2026-10-05) — wire types for /api/roastery-portal. Mirrors
// backend/src/services/roasteryPortalReads.ts; nothing here is a vocabulary.

export interface LookupOption { value: string; label: string }
export interface PortalDimension { dimensionId: number; label: string; lowLabel: string; highLabel: string }
export interface PortalArchetype { code: string; label: string; sortOrder: number }
export interface WheelDescriptor { id: string; descriptor: string }
export interface WheelSubcategory { name: string | null; descriptors: WheelDescriptor[] }
export interface WheelCategory { name: string; subcategories: WheelSubcategory[] }

export interface PortalVocabulary {
  process: LookupOption[];
  roastLevel: LookupOption[];
  blendOrSingle: LookupOption[];
  brewMethods: LookupOption[];
  availability: LookupOption[];
  notice: LookupOption[];
  similar: LookupOption[];
  takesIt: LookupOption[];
  blendRotation: LookupOption[];
  caffeine: LookupOption[];
  decafProcess: LookupOption[];
  certification: LookupOption[];
  dimensions: PortalDimension[];
  archetypes: PortalArchetype[];
  wheel: WheelCategory[];
}

export type CoffeeState = 'not_started' | 'in_progress' | 'submitted';

export interface LineupRow {
  portalCoffeeId: string;
  name: string;
  coffeeId: number | null;
  origin: string | null;
  processValues: string[];
  roastLevel: string | null;
  blendOrSingle: string | null;
  isDecaf: boolean | null;
  prefillSource: string | null;
  addedBy: string;
  sortOrder: number;
  isActive: boolean;
  state: CoffeeState;
  hasOpenDraft: boolean;
  sectionsAnswered: number;
  currentVersion: number | null;
  lastSavedAt: string | null;
  lastSavedByName: string | null;
  submittedAt: string | null;
  submittedByName: string | null;
  submittedVersionCount: number;
  hasUnmappedNotes: boolean;
}

export interface LineupResponse {
  id: string;
  version: number;
  status: 'draft' | 'submitted';
  typicalNotice: string | null;
  similarWhenOut: string | null;
  anythingElse: string | null;
  lastSavedByName: string | null;
  submittedByName: string | null;
  updatedAt: string;
  submittedAt: string | null;
  bestSellers: { portalCoffeeId: string; name: string; rank: number }[];
}

export interface ResponseNote { rank: number; roasterWords: string; cuppingNoteId: string | null; descriptor: string | null; wheelCategory: string | null }

export interface PortalResponse {
  id: string;
  portalCoffeeId: string;
  version: number;
  status: 'draft' | 'submitted';
  origin: string | null;
  processValues: string[];
  roastLevel: string | null;
  blendOrSingle: string | null;
  isDecaf: boolean | null;
  proposedArchetype: string | null;
  dominantDimensionId: number | null;
  takesIt: string | null;
  brewNotes: string | null;
  availability: string | null;
  typicalNotice: string | null;
  expectedAvailability: string | null;
  similarWhenOut: string | null;
  closestCousinPortalCoffeeId: string | null;
  whatChanges: string | null;
  anythingElse: string | null;
  additivesPresent: boolean | null;
  additivesDetail: string | null;
  blendComponents: string | null;
  blendRotation: string | null;
  caffeineLevel: string | null;
  decafProcess: string | null;
  certifications: string[];
  lastSavedByName: string | null;
  lastSavedByRespondentId: string | null;
  submittedByName: string | null;
  submittedByRespondentId: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  notes: ResponseNote[];
  dimensions: Record<string, number>;
  bestBrew: string | null;
  alsoGoodBrews: string[];
}

export interface Landing {
  roastery: { name: string };
  contact: { name: string | null; email: string | null };
  vocabulary: PortalVocabulary;
  lineup: LineupRow[];
  counts: { total: number; submitted: number };
  lineupResponse: LineupResponse | null;
}

/** The document the partner page edits and saves in full. */
export interface DocNote { key: string; words: string; cuppingNoteId: string | null }
export interface Doc {
  origin: string;
  processValues: string[];
  roastLevel: string | null;
  blendOrSingle: string | null;
  additivesPresent: boolean | null;
  additivesDetail: string;
  blendComponents: string;
  blendRotation: string | null;
  caffeineLevel: string | null;
  decafProcess: string | null;
  certifications: string[];
  notes: DocNote[];
  proposedArchetype: string | null;
  dimensions: Record<string, number>;
  dominantDimensionId: number | null;
  bestBrew: string | null;
  alsoGoodBrews: string[];
  takesIt: string | null;
  brewNotes: string;
  availability: string | null;
  typicalNotice: string | null;
  expectedAvailability: string;
  similarWhenOut: string | null;
  closestCousinPortalCoffeeId: string | null;
  whatChanges: string;
  anythingElse: string;
}
