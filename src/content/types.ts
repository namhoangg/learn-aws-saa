// Shapes of the files in content/. The authoring rules live in content/README.md and are
// enforced by tools/validate_content.mjs.

export type Domain = 'secure' | 'resilient' | 'performant' | 'cost';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type Category =
  | 'compute'
  | 'storage'
  | 'database'
  | 'networking'
  | 'security'
  | 'integration'
  | 'analytics'
  | 'ml'
  | 'management'
  | 'migration';

export interface Course {
  title: string;
  code: string;
  exam: {
    questions: number;
    minutes: number;
    passScore: number;
    maxScore: number;
    domains: { id: Domain; title: string; weight: number }[];
  };
  parts: { id: string; title: string; sections: string[] }[];
}

export interface Service {
  id: string;
  name: string;
  category: Category;
  core: boolean;
  summary: string;
}

export interface Relation {
  from: string;
  to: string;
  label: string;
}

export interface SectionMeta {
  id: string;
  order: number;
  title: string;
  courseSection: string;
  slides: [number, number];
  estimatedMinutes: number;
  summary: string;
  services: string[];
  relations: Relation[];
  examDomains: Domain[];
  lastVerified: string;
  sources: { title: string; url: string }[];
  newServices?: Service[];
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  tags?: string[];
  updated?: string;
  verify?: string;
}

export interface QuizOption {
  id: string;
  text: string;
  correct: boolean;
  explanation: string;
}

export interface QuizQuestion {
  id: string;
  type: 'single' | 'multi';
  domain: Domain;
  difficulty: Difficulty;
  question: string;
  options: QuizOption[];
  explanation: string;
  tags?: string[];
  updated?: string;
  verify?: string;
}

export interface LabFrontMatter {
  id: string;
  title: string;
  objective: string;
  estimatedTime: string;
  cost: string;
  freeTier: 'yes' | 'partial' | 'no';
  services: string[];
}

export interface Lab extends LabFrontMatter {
  file: string;
  body: string;
}

/** A flashcard or question tagged with the section it came from. */
export type WithSection<T> = T & { sectionId: string };
