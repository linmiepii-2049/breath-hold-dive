export type Lang = 'zh' | 'en';

export type SpeciesId =
  | 'sardine'
  | 'clownfish'
  | 'parrotfish'
  | 'turtle'
  | 'manta'
  | 'octopus'
  | 'shark'
  | 'orca';

export type MomentId = 'baitball' | 'turtleBreath' | 'orcaPass';

export type GearId = 'fins' | 'lens' | 'suit';

export type CommentId =
  | 'empty'
  | 'closer'
  | 'framing'
  | 'moment'
  | 'deep'
  | 'rare'
  | 'excellent'
  | 'solid'
  | 'danger'
  | 'school';

export const SPECIES: SpeciesId[] = [
  'sardine',
  'clownfish',
  'parrotfish',
  'turtle',
  'manta',
  'octopus',
  'shark',
  'orca',
];

export const MOMENTS: MomentId[] = ['baitball', 'turtleBreath', 'orcaPass'];

export interface AlbumEntry {
  score: number;
  dataUrl: string;
  comment: CommentId;
}
