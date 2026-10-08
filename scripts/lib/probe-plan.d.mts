// Types for probe-plan.mjs, so TypeScript tests can import it. Keep in step with the module.

export type ParamValue = string | number | boolean | string[];
export type Domain = 'film' | 'tv' | 'music' | 'book' | 'person' | 'brand';

/** The roles that stand for a move of the agent, made once on top of Encore's first call for a list. */
export type MoveRole = 'any-country' | 'wider-years' | 'no-age' | 'same-kind' | 'strongest' | 'taste-tags';

export type StepRole = 'search' | 'map' | 'control' | 'era' | 'era-country' | 'explain' | 'taste' | 'age' | 'score' | 'compare' | MoveRole;

export interface Step {
  id: string;
  persona: string;
  who: string;
  step: string;
  role: StepRole;
  kind: string;
  domain?: Domain;
  term?: string;
  endpoint: string;
  params: Record<string, ParamValue>;
}

export interface Persona {
  key: string;
  label: string;
  birthYear: number;
  country: string;
  names: readonly string[];
}

export interface YearRange {
  fromYear: number;
  toYear: number;
}

export const MAP_TAKE: number;
export const SEARCH_TAKE: number;
export const TASTE_WORD_TAKE: number;
export const SCORE_TAKE: number;
export const COMPARE_TAKE: number;
export const AGE_BAND: string;
export const SCORE_CANDIDATES: number;
export const MAX_SIGNALS: number;
export const YEAR_STEP: number;
export const STRONGEST_FAVOURITES: number;
export const MAX_TAG_SIGNALS: number;
export const MOVE_SUFFIX: Readonly<Record<MoveRole, string>>;
export const MOVE_ACTION: Readonly<Record<MoveRole, string>>;
export const MOVE_DOMAINS: Readonly<Record<MoveRole, readonly Domain[]>>;
export const DOMAIN_TYPE: Readonly<Record<Domain, string>>;
export const DOMAIN_LABEL: Readonly<Record<Domain, string>>;
export const DOMAIN_ORDER: readonly Domain[];
export const PERSONAS: readonly Persona[];
export const PRINTABLE_PARAMS: ReadonlySet<string>;

export function eraYears(birthYear: number, currentYear?: number): YearRange;
export function personBirthYears(birthYear: number): YearRange;
export function dateParams(domain: Domain, birthYear: number, currentYear?: number): Record<string, string | number>;
export function widerYears(years: YearRange, currentYear?: number): YearRange;
export function widerDateParams(domain: Domain, birthYear: number, currentYear?: number): Record<string, string | number>;
export function moveSteps(persona: Persona, signals: readonly string[], currentYear?: number, kinds?: Readonly<Partial<Record<Domain, readonly string[]>>>): Step[];
export function strongestSteps(persona: Persona, signals: readonly string[], strongestIds: readonly string[], currentYear?: number): Step[];
export function tasteTagSteps(persona: Persona, signals: readonly string[], tagIds: readonly string[], currentYear?: number): Step[];
export function describeParams(params: Readonly<Record<string, ParamValue | undefined>>): string;
export function searchSteps(): Step[];
export function personaSteps(persona: Persona, signals: readonly string[], currentYear?: number): Step[];
export function explainStep(persona: Persona, signals: readonly string[]): Step;
export function ageCheckStep(persona: Persona, domain: Domain, entityId: string): Step;
export function scoreStep(persona: Persona, signals: readonly string[], candidateIds: readonly string[], domain?: Domain): Step;
export function compareSteps(signalsByPersona: Readonly<Record<string, readonly string[]>>): Step[];
export function planPreview(currentYear?: number): Step[];
