import { Image, type ImageStyle, type StyleProp } from 'react-native';

const source = require('../../assets/images/logo.png') as number;
// The website's ticket wordmark (public/images/brand/fattixx-logo.png), 600 x 385 with a transparent background.
const RATIO = 600 / 385;

/** The Fattixx logo, sized by height, as on the website's nav and sign-in pages. */
export function Logo({ height = 36, style }: { height?: number; style?: StyleProp<ImageStyle> }) {
  return <Image source={source} accessibilityLabel="Fattixx" resizeMode="contain" style={[{ width: Math.round(height * RATIO), height }, style]} />;
}
