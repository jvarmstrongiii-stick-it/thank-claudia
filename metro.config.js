const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const WEB_EMPTY_MODULES = [
  '@react-native/debugger-frontend',
  'react-devtools-core',
  'expo-keep-awake',
];

const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_EMPTY_MODULES.some(m => moduleName.includes(m))) {
    return { type: 'empty' };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
