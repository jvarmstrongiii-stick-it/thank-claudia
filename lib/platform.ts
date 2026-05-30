import { Platform } from 'react-native';

const WEB = Platform.OS === 'web';

export const fs = (size: number) => Math.round(size * (WEB ? 1.4 : 1.3));
export const isWeb = WEB;

export const colors = {
  bg:        '#0b0c08',
  surface:   '#0e0f0a',
  surface2:  '#111114',
  border:    '#2a2b22',
  accent:    '#8fba3c',
  gold:      '#c8b97a',
  text:      '#d4d0b8',
  muted:     '#6b7252',
};
