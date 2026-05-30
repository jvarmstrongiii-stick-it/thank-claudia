import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { RussoOne_400Regular } from '@expo-google-fonts/russo-one';
import { ShareTechMono_400Regular } from '@expo-google-fonts/share-tech-mono';
import { Barlow_400Regular, Barlow_600SemiBold } from '@expo-google-fonts/barlow';
import { View, ActivityIndicator } from 'react-native';

export default function RootLayout() {
  const [loaded] = useFonts({
    RussoOne_400Regular,
    ShareTechMono_400Regular,
    Barlow_400Regular,
    Barlow_600SemiBold,
  });

  if (!loaded) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0b0c08', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#8fba3c" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#0b0c08' },
        }}
      />
    </>
  );
}
