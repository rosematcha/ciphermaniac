export type Layout = 'keepsake' | 'ticket';
export type ThirdRow = 'none' | 'text' | 'stars';
export type StubContent = 'stars' | 'progress' | 'count';
export type DuoSizing = 'primary-larger' | 'equal';
export type SpriteSide = 'left' | 'right';
export type SubtitleStyle = 'italic' | 'regular' | 'caps';

export interface LabelConfig {
  layout: Layout;
  pokemon1: string | null;
  pokemon2: string | null;
  duoSizing: DuoSizing;
  titleBreak: boolean;
  spriteSide: SpriteSide;
  title: string;
  subtitle: string;
  subtitleStyle: SubtitleStyle;
  thirdRow: ThirdRow;
  stars: number;
  starsMax: number;
  progressCurrent: number;
  progressTotal: number;
  extraText: string;
  stubContent: StubContent;
  stubLabel: string;
  formatText: string;
}

export const defaultConfig: LabelConfig = {
  layout: 'keepsake',
  pokemon1: null,
  pokemon2: null,
  duoSizing: 'primary-larger',
  titleBreak: true,
  spriteSide: 'left',
  title: '',
  subtitle: '',
  subtitleStyle: 'italic',
  thirdRow: 'none',
  stars: 3,
  starsMax: 5,
  progressCurrent: 42,
  progressTotal: 60,
  extraText: '',
  stubContent: 'stars',
  stubLabel: 'COMPLEXITY',
  formatText: ''
};
